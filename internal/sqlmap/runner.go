// Package sqlmap runs sqlmap against a raw HTTP request and streams output.
package sqlmap

import (
	"bufio"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// Options controls sqlmap behaviour.
type Options struct {
	Level  int    `json:"level"`
	Risk   int    `json:"risk"`
	DBs    bool   `json:"dbs"`
	Tables bool   `json:"tables"`
	Dump   bool   `json:"dump"`
	Extra  string `json:"extra"`
}

var ansiRE = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)

func stripANSI(s string) string { return ansiRE.ReplaceAllString(s, "") }

// normalizeRequestFile converts a raw HTTP request (as produced by httputil.DumpRequest
// when the proxy receives it) into the format sqlmap expects:
//   - First line target must be a relative path, not an absolute URL
//   - Proxy-specific headers (Proxy-Connection) are stripped
//   - Line endings are normalised to \r\n
// normalizeRequestFile converts a raw HTTP request into the format sqlmap expects.
//
// Fixes applied:
//   - First-line target: absolute URL → relative path  (goproxy captures abs-form)
//   - Missing Host header: injected from the absolute URL's host
//   - Proxy-Connection header: stripped
//   - Line endings: normalised to \r\n
func normalizeRequestFile(raw string) string {
	nlIdx := strings.IndexByte(raw, '\n')
	if nlIdx < 0 {
		return raw
	}
	firstLine := strings.TrimRight(raw[:nlIdx], "\r")
	rest := raw[nlIdx+1:]

	parts := strings.SplitN(firstLine, " ", 3)
	if len(parts) != 3 {
		return raw
	}
	method, target, proto := parts[0], parts[1], strings.TrimSpace(parts[2])

	// Extract host before stripping the absolute URL so we can inject it if needed
	extractedHost := ""
	if strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "https://") {
		if u, err := url.Parse(target); err == nil {
			extractedHost = u.Host
			target = u.RequestURI()
			if target == "" {
				target = "/"
			}
		}
	}

	// Scan existing headers
	var headerLines []string
	hasHost := false
	for _, line := range strings.Split(rest, "\n") {
		trimmed := strings.TrimRight(line, "\r")
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "proxy-connection:") {
			continue // strip proxy artefact
		}
		if strings.HasPrefix(lower, "host:") {
			hasHost = true
		}
		headerLines = append(headerLines, trimmed)
	}

	var out strings.Builder
	out.WriteString(method + " " + target + " " + proto + "\r\n")

	// sqlmap REQUIRES a Host header — inject it if the dump omitted it
	if !hasHost && extractedHost != "" {
		out.WriteString("Host: " + extractedHost + "\r\n")
	}

	for _, line := range headerLines {
		out.WriteString(line + "\r\n")
	}
	return out.String()
}

// findSQLMap returns the executable and any prefix args needed to invoke it.
func findSQLMap() (bin string, prefix []string) {
	if p, err := exec.LookPath("sqlmap"); err == nil {
		return p, nil
	}
	// Windows: pip may install to user Scripts directory
	if runtime.GOOS == "windows" {
		home, _ := os.UserHomeDir()
		for _, ver := range []string{"Python313", "Python312", "Python311", "Python310", "Python39", "Python38"} {
			p := filepath.Join(home, "AppData", "Roaming", "Python", ver, "Scripts", "sqlmap.exe")
			if _, err := os.Stat(p); err == nil {
				return p, nil
			}
			// Also check local AppData
			p2 := filepath.Join(home, "AppData", "Local", "Programs", "Python", ver, "Scripts", "sqlmap.exe")
			if _, err := os.Stat(p2); err == nil {
				return p2, nil
			}
		}
	}
	// Fallback: run as python module
	for _, py := range []string{"python3", "python", "py"} {
		if p, err := exec.LookPath(py); err == nil {
			return p, []string{"-m", "sqlmap"}
		}
	}
	return "", nil
}

// Run launches sqlmap with the provided raw HTTP request, streaming each output
// line to onOutput until the process exits or stop is closed.
func Run(rawRequest, proxyAddr string, opts Options, onOutput func(string), stop <-chan struct{}) error {
	bin, prefix := findSQLMap()
	if bin == "" {
		return fmt.Errorf("sqlmap not found — install with: pip install sqlmap")
	}

	normalized := normalizeRequestFile(rawRequest)
	tmp := filepath.Join(os.TempDir(), fmt.Sprintf("harness_req_%d.txt", time.Now().UnixNano()))
	if err := os.WriteFile(tmp, []byte(normalized), 0600); err != nil {
		return fmt.Errorf("write request file: %v", err)
	}
	defer os.Remove(tmp)

	// Show the user exactly what sqlmap will see — makes format issues obvious
	onOutput("─── request file ────────────────────────────────────────────────")
	for i, line := range strings.SplitN(normalized, "\n", 6) {
		line = strings.TrimRight(line, "\r")
		onOutput(line)
		if i >= 4 {
			onOutput("  ...")
			break
		}
	}
	onOutput("─────────────────────────────────────────────────────────────────")

	lvl := opts.Level
	if lvl < 1 {
		lvl = 1
	}
	if lvl > 5 {
		lvl = 5
	}
	rsk := opts.Risk
	if rsk < 1 {
		rsk = 1
	}
	if rsk > 3 {
		rsk = 3
	}

	args := append(append([]string{}, prefix...),
		"-r", tmp,
		"--proxy", "http://"+proxyAddr,
		"--batch",
		"--level", fmt.Sprint(lvl),
		"--risk", fmt.Sprint(rsk),
	)
	if opts.DBs {
		args = append(args, "--dbs")
	}
	if opts.Tables {
		args = append(args, "--tables")
	}
	if opts.Dump {
		args = append(args, "--dump")
	}
	if opts.Extra != "" {
		args = append(args, strings.Fields(opts.Extra)...)
	}

	cmd := exec.Command(bin, args...)
	hideCmdWindow(cmd) // suppress console window on Windows

	// Merge stdout + stderr through a single pipe
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		pw.Close()
		return fmt.Errorf("could not start sqlmap: %v — install with: pip install sqlmap", err)
	}

	// Signal when the process exits so the stop-watcher goroutine can exit cleanly
	processDone := make(chan struct{})

	// Close the pipe write-end when the process exits, which signals EOF to the scanner
	go func() {
		cmd.Wait()
		pw.Close()
		close(processDone)
	}()

	// Kill the process if stop is signaled before it finishes
	go func() {
		select {
		case <-stop:
			if cmd.Process != nil {
				cmd.Process.Kill()
			}
		case <-processDone:
		}
	}()

	scanner := bufio.NewScanner(pr)
	for scanner.Scan() {
		onOutput(stripANSI(scanner.Text()))
	}
	return nil
}
