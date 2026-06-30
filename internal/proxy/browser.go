package proxy

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// LaunchBrowser finds a Chromium-based browser and launches it with Harness
// proxy pre-configured and cert errors suppressed.
func (a *App) LaunchBrowser() (string, error) {
	binary, err := findBrowser()
	if err != nil {
		log.Printf("LaunchBrowser: no browser found: %v", err)
		return "", err
	}
	log.Printf("LaunchBrowser: using %s", binary)

	dataDir, _ := os.UserConfigDir()
	profileDir := filepath.Join(dataDir, "harness", "chrome-profile")
	if err := os.MkdirAll(profileDir, 0700); err != nil {
		return "", fmt.Errorf("could not create profile dir: %v", err)
	}
	// Suppress Chrome's first-run wizard
	os.WriteFile(filepath.Join(profileDir, "First Run"), []byte{}, 0644)

	args := []string{
		"--proxy-server=http://127.0.0.1:8080",
		// Route localhost/127.0.0.1 through the proxy so test servers are visible.
		// <-loopback> removes loopback from Chrome's default bypass list.
		"--proxy-bypass-list=<-loopback>",
		"--user-data-dir=" + profileDir,
		"--ignore-certificate-errors",
		"--ignore-ssl-errors",
		"--no-first-run",
		"--no-default-browser-check",
		"--no-service-autorun",
		// Suppress background networking, updates, telemetry
		"--disable-sync",
		"--disable-extensions",
		"--disable-background-networking",
		"--disable-background-mode",
		"--disable-client-side-phishing-detection",
		"--disable-component-updater",
		"--disable-domain-reliability",
		"--disable-default-apps",
		"--disable-breakpad",
		"--dns-prefetch-disable",
		"--no-pings",
		"--metrics-recording-only",
		"--safebrowsing-disable-auto-update",
		// Suppress the "Managed by organization" / controlled profile infobars
		"--disable-infobars",
		"--disable-features=TranslateUI,OptimizationGuideModelDownloading,MediaRouter,DialMediaRouteProvider,OptimizationHints,ChromeWhatsNewUI",
		"http://localhost:9090",
	}

	cmd := exec.Command(binary, args...)
	detachProcess(cmd)

	if err := cmd.Start(); err != nil {
		log.Printf("LaunchBrowser: cmd.Start failed: %v", err)
		return "", fmt.Errorf("failed to start browser (%s): %v", binary, err)
	}
	log.Printf("LaunchBrowser: launched PID %d", cmd.Process.Pid)

	a.browserMu.Lock()
	a.browserCmd = cmd
	a.browserMu.Unlock()

	go func() {
		cmd.Wait()
		a.browserMu.Lock()
		if a.browserCmd == cmd {
			a.browserCmd = nil
		}
		a.browserMu.Unlock()
		a.broadcast(map[string]interface{}{"type": "browser_stopped"})
	}()

	return fmt.Sprintf(
		"✓ Launched %s\n\nProxy:   127.0.0.1:8080 (pre-configured)\nCerts:   errors suppressed — browse any HTTPS site\nProfile: isolated from your personal browser data\n\nAll traffic will appear in the Proxy tab.",
		filepath.Base(binary),
	), nil
}

// findBrowser returns the first usable browser binary.
func findBrowser() (string, error) {
	tried := []string{}
	for _, path := range allBrowserCandidates() {
		if path == "" {
			continue
		}
		tried = append(tried, path)
		if filepath.IsAbs(path) {
			if _, err := os.Stat(path); err == nil {
				return path, nil
			}
		} else {
			if p, err := exec.LookPath(path); err == nil {
				return p, nil
			}
		}
	}
	list := ""
	for _, p := range tried {
		list += "\n  • " + p
	}
	return "", fmt.Errorf("no Chrome, Edge, or Brave found. Searched:%s\n\nInstall Chrome from https://www.google.com/chrome", list)
}

// allBrowserCandidates returns every possible browser path for the current OS.
// The windows case is handled by windowsBrowserCandidates() in browser_windows.go.
func allBrowserCandidates() []string {
	switch runtime.GOOS {
	case "darwin":
		return []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		}
	case "windows":
		return windowsBrowserCandidates()
	default: // Linux
		return []string{
			"google-chrome", "google-chrome-stable",
			"chromium", "chromium-browser",
			"brave-browser", "microsoft-edge",
			"/usr/bin/google-chrome",
			"/usr/bin/chromium",
			"/usr/bin/chromium-browser",
			"/snap/bin/chromium",
		}
	}
}
