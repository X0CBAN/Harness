//go:build windows

package proxy

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

func detachProcess(cmd *exec.Cmd) {
	// CREATE_NEW_PROCESS_GROUP keeps the child alive after Harness exits
	// and isolates it from Ctrl+C signals sent to the parent.
	// HideWindow must NOT be set here — it would hide the browser window.
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
}

// registryGetString reads a string value from the Windows registry.
// Uses raw syscall so we don't need golang.org/x/sys.
func registryGetString(root syscall.Handle, path, valueName string) string {
	var hkey syscall.Handle
	pathPtr, _ := syscall.UTF16PtrFromString(path)
	if err := syscall.RegOpenKeyEx(root, pathPtr, 0, syscall.KEY_READ, &hkey); err != nil {
		return ""
	}
	defer syscall.RegCloseKey(hkey)

	var typ uint32
	var buf [1024]uint16
	n := uint32(len(buf) * 2)
	var namePtr *uint16
	if valueName != "" {
		namePtr, _ = syscall.UTF16PtrFromString(valueName)
	}

	err := syscall.RegQueryValueEx(hkey, namePtr, nil, &typ, (*byte)(unsafe.Pointer(&buf[0])), &n)
	if err != nil {
		return ""
	}
	return syscall.UTF16ToString(buf[:n/2])
}

// windowsBrowserCandidates checks the Windows registry first (authoritative),
// then falls back to known filesystem paths.
func windowsBrowserCandidates() []string {
	var candidates []string

	// HKLM and HKCU App Paths entries — set by Chrome/Edge installers
	// Default value (empty string key) contains the full exe path
	regPaths := []struct {
		root syscall.Handle
		path string
	}{
		{syscall.HKEY_LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe`},
		{syscall.HKEY_CURRENT_USER, `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe`},
		{syscall.HKEY_LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe`},
		{syscall.HKEY_CURRENT_USER, `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe`},
		{syscall.HKEY_LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\brave.exe`},
		{syscall.HKEY_CURRENT_USER, `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\brave.exe`},
	}

	for _, rp := range regPaths {
		if val := registryGetString(rp.root, rp.path, ""); val != "" {
			candidates = append(candidates, val)
		}
	}

	// Filesystem fallbacks — cover all common install locations
	localApp := os.Getenv("LOCALAPPDATA")
	progFiles := os.Getenv("PROGRAMFILES")
	progFilesX86 := os.Getenv("PROGRAMFILES(X86)")

	if localApp == "" {
		localApp = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Local")
	}
	if progFiles == "" {
		progFiles = `C:\Program Files`
	}
	if progFilesX86 == "" {
		progFilesX86 = `C:\Program Files (x86)`
	}

	candidates = append(candidates, []string{
		// Chrome per-user (most common — website installer)
		filepath.Join(localApp, "Google", "Chrome", "Application", "chrome.exe"),
		// Chrome system-wide (MSI / enterprise)
		filepath.Join(progFiles, "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(progFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
		// Edge (ships with Windows — almost always present)
		filepath.Join(progFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(progFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(localApp, "Microsoft", "Edge", "Application", "msedge.exe"),
		// Brave
		filepath.Join(progFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
		filepath.Join(localApp, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
	}...)

	return candidates
}
