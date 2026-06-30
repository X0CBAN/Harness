// Package nuclei runs nuclei vulnerability scanner and streams output.
package nuclei

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

// Options controls nuclei behaviour.
type Options struct {
	Target    string `json:"target"`
	Tags      string `json:"tags"`      // comma-separated: cve,xss,sqli,lfi
	Severity  string `json:"severity"`  // info,low,medium,high,critical
	Templates string `json:"templates"` // path or template ID
	UseProxy  bool   `json:"useProxy"`  // route through harness proxy
	RateLimit int    `json:"rateLimit"`
	Extra     string `json:"extra"`
}

var ansiRE = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)

func stripANSI(s string) string { return ansiRE.ReplaceAllString(s, "") }

// IsInstalled returns true if nuclei is available on PATH or in common locations.
func IsInstalled() bool {
	return findNuclei() != ""
}

func findNuclei() string {
	if p, err := exec.LookPath("nuclei"); err == nil {
		return p
	}
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		candidates := []string{
			filepath.Join(home, "go", "bin", "nuclei.exe"),
			filepath.Join(home, "AppData", "Local", "Programs", "nuclei", "nuclei.exe"),
			`C:\Program Files\nuclei\nuclei.exe`,
			`C:\tools\nuclei\nuclei.exe`,
		}
		for _, p := range candidates {
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	case "linux":
		candidates := []string{
			filepath.Join(home, "go", "bin", "nuclei"),
			filepath.Join(home, ".local", "bin", "nuclei"),
			"/usr/local/bin/nuclei",
			"/usr/bin/nuclei",
			"/snap/bin/nuclei",
		}
		for _, p := range candidates {
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	case "darwin":
		candidates := []string{
			filepath.Join(home, "go", "bin", "nuclei"),
			"/usr/local/bin/nuclei",
			"/opt/homebrew/bin/nuclei",
		}
		for _, p := range candidates {
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	}
	return ""
}

// Run launches nuclei against the given target, streaming each output line to onOutput.
func Run(opts Options, proxyAddr string, onOutput func(string), stop <-chan struct{}) error {
	bin := findNuclei()
	if bin == "" {
		return fmt.Errorf("nuclei not found — install with: go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest")
	}

	if opts.Target == "" {
		return fmt.Errorf("no target URL specified")
	}

	args := []string{
		"-u", opts.Target,
		"-no-color",
		"-silent",
		"-nc",
	}

	if opts.Tags != "" {
		args = append(args, "-tags", opts.Tags)
	}
	if opts.Severity != "" {
		args = append(args, "-severity", opts.Severity)
	}
	if opts.Templates != "" {
		args = append(args, "-t", opts.Templates)
	}
	if opts.UseProxy && proxyAddr != "" {
		args = append(args, "-proxy", "http://"+proxyAddr)
	}
	if opts.RateLimit > 0 {
		args = append(args, "-rate-limit", fmt.Sprint(opts.RateLimit))
	}
	if opts.Extra != "" {
		args = append(args, strings.Fields(opts.Extra)...)
	}

	cmd := exec.Command(bin, args...)
	hideCmdWindow(cmd)

	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		pw.Close()
		return fmt.Errorf("could not start nuclei: %v", err)
	}

	processDone := make(chan struct{})
	go func() {
		cmd.Wait()
		pw.Close()
		close(processDone)
	}()

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
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	for scanner.Scan() {
		line := stripANSI(scanner.Text())
		if line != "" {
			onOutput(line)
		}
	}
	return nil
}
