package cert

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// InstallToSystem installs the CA cert into the OS trust store.
func (m *Manager) InstallToSystem() (string, error) {
	switch runtime.GOOS {
	case "darwin":
		return m.installMacOS()
	case "windows":
		return m.installWindows()
	case "linux":
		return m.installLinux()
	default:
		return "", fmt.Errorf("not supported on %s — download and import manually", runtime.GOOS)
	}
}

func (m *Manager) installMacOS() (string, error) {
	cmd := exec.Command("sudo", "security", "add-trusted-cert",
		"-d", "-r", "trustRoot",
		"-k", "/Library/Keychains/System.keychain",
		m.caPath,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("keychain install failed: %s", string(out))
	}
	return "CA installed to System keychain. Restart your browser.", nil
}

func (m *Manager) installWindows() (string, error) {
	// Write raw DER bytes to a temp .crt file.
	// m.caPath is PEM — Windows needs DER (raw binary, no base64 headers).
	tmp := filepath.Join(os.TempDir(), "harness-ca.crt")
	if err := os.WriteFile(tmp, m.caCert.Raw, 0644); err != nil {
		return "", fmt.Errorf("could not write cert to temp: %v", err)
	}

	// Use PowerShell Import-Certificate — no UAC popup, works for current user.
	// CurrentUser\Root is trusted by Chrome, Edge, and IE for this user account.
	ps := fmt.Sprintf(
		`$r = Import-Certificate -FilePath '%s' -CertStoreLocation Cert:\CurrentUser\Root; $r.Thumbprint`,
		tmp,
	)
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", ps)
	out, err := cmd.CombinedOutput()
	os.Remove(tmp)

	if err != nil {
		return "", fmt.Errorf("PowerShell import failed:\n%s\n\nTry the manual steps below.", string(out))
	}

	thumb := string(out)
	return fmt.Sprintf("Installed! Thumbprint: %s\nRestart Chrome or Edge. Firefox needs a manual import (see below).", thumb), nil
}

// ExportDER writes the CA cert as a DER file to the given path.
// This is what the frontend download button calls — DER is what
// Windows double-click install expects.
func (m *Manager) ExportDER(path string) error {
	return os.WriteFile(path, m.caCert.Raw, 0644)
}

func (m *Manager) installLinux() (string, error) {
	dest := "/usr/local/share/ca-certificates/harness-ca.crt"
	tmp := filepath.Join(os.TempDir(), "harness-ca.crt")
	if err := os.WriteFile(tmp, m.caCert.Raw, 0644); err != nil {
		return "", err
	}
	installer := "pkexec"
	if _, err := exec.LookPath("pkexec"); err != nil {
		installer = "sudo"
	}
	script := fmt.Sprintf("cp %s %s && update-ca-certificates", tmp, dest)
	cmd := exec.Command(installer, "sh", "-c", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("install failed: %s", string(out))
	}
	return "CA installed. Firefox needs a manual import.", nil
}
