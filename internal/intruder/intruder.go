package intruder

import (
	"bufio"
	"bytes"
	"crypto/md5"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"html"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Transform defines a payload transformation applied before substitution.
type Transform struct {
	Type  string `json:"type"`  // url_encode, url_decode, base64_encode, base64_decode, md5, sha256, prefix, suffix, uppercase, lowercase, reverse, html_encode, hex_encode, hex_decode
	Value string `json:"value"` // for prefix/suffix: text to prepend/append
}

func reverseString(s string) string {
	runes := []rune(s)
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}
	return string(runes)
}

func hexEncode(s string) string {
	return hex.EncodeToString([]byte(s))
}

func hexDecode(s string) string {
	b, err := hex.DecodeString(s)
	if err != nil {
		return s
	}
	if !utf8.Valid(b) {
		return s
	}
	return string(b)
}

func applyTransforms(payload string, transforms []Transform) string {
	for _, t := range transforms {
		switch t.Type {
		case "url_encode":
			payload = url.QueryEscape(payload)
		case "url_decode":
			if d, err := url.QueryUnescape(payload); err == nil {
				payload = d
			}
		case "base64_encode":
			payload = base64.StdEncoding.EncodeToString([]byte(payload))
		case "base64_decode":
			if b, err := base64.StdEncoding.DecodeString(payload); err == nil {
				payload = string(b)
			}
		case "prefix":
			payload = t.Value + payload
		case "suffix":
			payload = payload + t.Value
		case "md5":
			h := md5.Sum([]byte(payload))
			payload = hex.EncodeToString(h[:])
		case "sha256":
			h := sha256.Sum256([]byte(payload))
			payload = hex.EncodeToString(h[:])
		case "uppercase":
			payload = strings.ToUpper(payload)
		case "lowercase":
			payload = strings.ToLower(payload)
		case "reverse":
			payload = reverseString(payload)
		case "html_encode":
			payload = html.EscapeString(payload)
		case "hex_encode":
			payload = hexEncode(payload)
		case "hex_decode":
			payload = hexDecode(payload)
		}
	}
	return payload
}

// AttackMode defines how payloads are applied to positions.
type AttackMode string

const (
	Sniper       AttackMode = "sniper"        // one payload set, cycle through positions one at a time
	BatteringRam AttackMode = "battering_ram" // one payload set, same value in all positions
	Pitchfork    AttackMode = "pitchfork"     // multiple payload sets, advance in lockstep
	ClusterBomb  AttackMode = "cluster_bomb"  // multiple payload sets, every combination
)

// Attack defines an intruder run.
type Attack struct {
	RawRequest   string      `json:"rawRequest"`   // request template with §markers§
	Host         string      `json:"host"`
	UseHTTPS     bool        `json:"useHttps"`
	Mode         AttackMode  `json:"mode"`
	PayloadSets  [][]string  `json:"payloadSets"`  // one slice per position (small payloads)
	PayloadFiles []string    `json:"payloadFiles"` // file paths for large payloads (streamed, one per position)
	Concurrency  int         `json:"concurrency"`  // number of parallel goroutines
	DelayMs      int         `json:"delayMs"`      // delay between requests (per worker)
	GrepMatch    []string    `json:"grepMatch"`    // flag responses containing any of these strings
	Transforms   []Transform `json:"transforms"`   // transformations applied to each payload value
}

// Result is one fuzzing result row.
type Result struct {
	Index       int      `json:"index"`
	Payload     string   `json:"payload"` // combined payload label
	StatusCode  int      `json:"statusCode"`
	Length      int      `json:"length"`
	DurationMs  int64    `json:"durationMs"`
	Matched     []string `json:"matched"` // which grep strings were found
	RequestRaw  string   `json:"requestRaw,omitempty"`  // actual sent request (with payload substituted)
	ResponseRaw string   `json:"responseRaw,omitempty"`
	Error       string   `json:"error,omitempty"`
}

// ProgressFunc is called after each request with the result.
type ProgressFunc func(r Result)

// extractPositions finds §marker§ positions and returns position indices.
func extractPositions(raw string) ([]int, []int) {
	var starts, ends []int
	i := 0
	for i < len(raw) {
		start := strings.Index(raw[i:], "§")
		if start == -1 {
			break
		}
		start += i
		end := strings.Index(raw[start+2:], "§")
		if end == -1 {
			break
		}
		end = end + start + 2
		starts = append(starts, start)
		ends = append(ends, end)
		i = end + 2
	}
	return starts, ends
}

// buildRequest replaces §markers§ with the given payloads (one per position).
func buildRequest(template string, payloads []string) string {
	starts, ends := extractPositions(template)
	if len(starts) == 0 {
		return template
	}

	var out strings.Builder
	prev := 0
	for i, start := range starts {
		out.WriteString(template[prev:start])
		if i < len(payloads) {
			out.WriteString(payloads[i])
		}
		prev = ends[i] + 2 // skip closing §
	}
	out.WriteString(template[prev:])
	return out.String()
}

// generateRequests produces all (payloads) combinations based on attack mode.
func generateRequests(a *Attack) [][]string {
	starts, ends := extractPositions(a.RawRequest)
	numPositions := len(starts)

	// Original values sitting between each pair of § markers.
	originals := make([]string, numPositions)
	for i := range starts {
		originals[i] = a.RawRequest[starts[i]+2 : ends[i]]
	}

	switch a.Mode {
	case Sniper:
		// Cycle through each position with each payload, one at a time.
		// Non-targeted positions keep their original value from the template.
		var combos [][]string
		for pos := 0; pos < numPositions; pos++ {
			payloads := a.PayloadSets[0]
			for _, p := range payloads {
				combo := make([]string, numPositions)
				copy(combo, originals)
				combo[pos] = p
				combos = append(combos, combo)
			}
		}
		return combos

	case BatteringRam:
		// Same payload in all positions
		var combos [][]string
		for _, p := range a.PayloadSets[0] {
			combo := make([]string, numPositions)
			for i := range combo {
				combo[i] = p
			}
			combos = append(combos, combo)
		}
		return combos

	case Pitchfork:
		// Advance all payload sets in lockstep
		minLen := len(a.PayloadSets[0])
		for _, ps := range a.PayloadSets[1:] {
			if len(ps) < minLen {
				minLen = len(ps)
			}
		}
		var combos [][]string
		for i := 0; i < minLen; i++ {
			combo := make([]string, numPositions)
			for pos := 0; pos < numPositions && pos < len(a.PayloadSets); pos++ {
				combo[pos] = a.PayloadSets[pos][i]
			}
			combos = append(combos, combo)
		}
		return combos

	case ClusterBomb:
		// Every combination — cartesian product
		return cartesian(a.PayloadSets)
	}

	return nil
}

func cartesian(sets [][]string) [][]string {
	if len(sets) == 0 {
		return [][]string{{}}
	}
	rest := cartesian(sets[1:])
	var result [][]string
	for _, item := range sets[0] {
		for _, combo := range rest {
			newCombo := append([]string{item}, combo...)
			result = append(result, newCombo)
		}
	}
	return result
}

type job struct {
	index    int
	payloads []string
}

// newClient creates the shared HTTP client used by all workers.
func newClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			TLSClientConfig:   &tls.Config{InsecureSkipVerify: true},
			DisableKeepAlives: true,
		},
		Timeout: 30 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// runWorkers starts concurrency workers draining the jobs channel.
func runWorkers(client *http.Client, a *Attack, jobs <-chan job, progress ProgressFunc, stop <-chan struct{}) {
	concurrency := a.Concurrency
	if concurrency <= 0 {
		concurrency = 10
	}
	var wg sync.WaitGroup
	for w := 0; w < concurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				select {
				case <-stop:
					return
				default:
				}
				if a.DelayMs > 0 {
					time.Sleep(time.Duration(a.DelayMs) * time.Millisecond)
				}
				progress(fireRequest(client, a, j.payloads, j.index))
			}
		}()
	}
	wg.Wait()
}

// Run executes the attack, calling progress for each result.
func Run(a *Attack, progress ProgressFunc, stop <-chan struct{}) {
	// If any PayloadFiles are set, use the memory-efficient streaming path.
	// Streaming is supported for Sniper and BatteringRam; other modes fall through
	// to the in-memory path (which loads the file).
	if len(a.PayloadFiles) > 0 {
		filePath := a.PayloadFiles[0]
		if filePath != "" && (a.Mode == Sniper || a.Mode == BatteringRam || a.Mode == "") {
			runStreaming(a, filePath, progress, stop)
			return
		}
		// For Pitchfork/ClusterBomb, load the file into memory first.
		if filePath != "" {
			if len(a.PayloadSets) == 0 {
				a.PayloadSets = make([][]string, len(a.PayloadFiles))
			}
			for i, fp := range a.PayloadFiles {
				if fp != "" {
					a.PayloadSets[i] = readFileLines(fp)
				}
			}
		}
	}

	// In-memory path (small payloads or Pitchfork/ClusterBomb).
	combos := generateRequests(a)
	concurrency := a.Concurrency
	if concurrency <= 0 {
		concurrency = 10
	}
	jobs := make(chan job, min(len(combos), concurrency*4))
	client := newClient()

	go func() {
		for i, combo := range combos {
			select {
			case <-stop:
				close(jobs)
				return
			default:
				jobs <- job{index: i, payloads: combo}
			}
		}
		close(jobs)
	}()
	runWorkers(client, a, jobs, progress, stop)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// readFileLines reads a text file into a string slice, skipping blank lines.
func readFileLines(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 512*1024), 512*1024)
	var lines []string
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), "\r")
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

// runStreaming streams a payload file line-by-line, never loading it all into RAM.
// Supports Sniper and BatteringRam modes.
func runStreaming(a *Attack, filePath string, progress ProgressFunc, stop <-chan struct{}) {
	concurrency := a.Concurrency
	if concurrency <= 0 {
		concurrency = 10
	}

	starts, ends := extractPositions(a.RawRequest)
	numPositions := len(starts)
	originals := make([]string, numPositions)
	for i := range starts {
		originals[i] = a.RawRequest[starts[i]+2 : ends[i]]
	}

	jobs := make(chan job, concurrency*4)
	client := newClient()

	// Start workers
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		runWorkers(client, a, jobs, progress, stop)
	}()

	f, err := os.Open(filePath)
	if err != nil {
		close(jobs)
		wg.Wait()
		return
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 512*1024), 512*1024)

	idx := 0
	mode := a.Mode
	if mode == "" {
		mode = Sniper
	}

outer:
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), "\r")
		if line == "" {
			continue
		}
		select {
		case <-stop:
			break outer
		default:
		}

		switch mode {
		case BatteringRam:
			combo := make([]string, numPositions)
			for i := range combo {
				combo[i] = line
			}
			select {
			case <-stop:
				break outer
			case jobs <- job{index: idx, payloads: combo}:
				idx++
			}

		default: // Sniper
			for pos := 0; pos < numPositions; pos++ {
				combo := make([]string, numPositions)
				copy(combo, originals)
				combo[pos] = line
				select {
				case <-stop:
					break outer
				case jobs <- job{index: idx, payloads: combo}:
					idx++
				}
			}
		}
	}

	close(jobs)
	wg.Wait()
}

func fireRequest(client *http.Client, a *Attack, payloads []string, index int) Result {
	start := time.Now()

	// Apply transforms to each payload value before substitution.
	transformed := make([]string, len(payloads))
	for i, p := range payloads {
		transformed[i] = applyTransforms(p, a.Transforms)
	}
	raw := buildRequest(a.RawRequest, transformed)
	requestRaw := raw // save the substituted request for display

	httpReq, err := http.ReadRequest(bufio.NewReader(strings.NewReader(raw)))
	if err != nil {
		return Result{Index: index, Payload: strings.Join(payloads, " | "), Error: err.Error()}
	}

	httpReq.RequestURI = ""
	scheme := "http"
	if a.UseHTTPS {
		scheme = "https"
	}
	host := a.Host
	if !strings.Contains(host, ":") {
		if a.UseHTTPS {
			host += ":443"
		} else {
			host += ":80"
		}
	}

	// Build a clean URL the same way the repeater does — avoids opaque URL issues.
	cleanPath := httpReq.URL.Path
	if cleanPath == "" {
		cleanPath = "/"
	}
	httpReq.URL = &url.URL{
		Scheme:   scheme,
		Host:     host,
		Path:     cleanPath,
		RawQuery: httpReq.URL.RawQuery,
	}
	httpReq.Host = strings.TrimSuffix(host, ":80")
	if a.UseHTTPS {
		httpReq.Host = strings.TrimSuffix(host, ":443")
	}

	// Re-read body to get accurate length after payload substitution.
	// Mismatched Content-Length is the primary cause of "unexpected EOF".
	if httpReq.Body != nil {
		bodyBytes, _ := io.ReadAll(httpReq.Body)
		httpReq.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		httpReq.ContentLength = int64(len(bodyBytes))
		if len(bodyBytes) > 0 {
			httpReq.Header.Set("Content-Length", strconv.Itoa(len(bodyBytes)))
		}
	}

	// Remove headers that cause problems with direct connections.
	httpReq.Header.Del("Accept-Encoding")
	httpReq.Header.Del("Proxy-Connection")

	resp, err := client.Do(httpReq)
	if err != nil {
		return Result{
			Index:      index,
			Payload:    strings.Join(payloads, " | "),
			DurationMs: time.Since(start).Milliseconds(),
			RequestRaw: requestRaw,
			Error:      err.Error(),
		}
	}
	defer resp.Body.Close()

	body, _ := httputil.DumpResponse(resp, true)
	bodyLen := len(body)

	// Run grep-match against the full raw response.
	var matched []string
	if len(a.GrepMatch) > 0 {
		text := string(body)
		for _, needle := range a.GrepMatch {
			if needle != "" && strings.Contains(text, needle) {
				matched = append(matched, needle)
			}
		}
	}

	return Result{
		Index:       index,
		Payload:     strings.Join(payloads, " | "),
		StatusCode:  resp.StatusCode,
		Length:      bodyLen,
		DurationMs:  time.Since(start).Milliseconds(),
		Matched:     matched,
		RequestRaw:  requestRaw,
		ResponseRaw: string(body),
	}
}
