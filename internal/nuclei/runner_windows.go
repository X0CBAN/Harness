//go:build windows

package nuclei

import (
	"os/exec"
	"syscall"
)

func hideCmdWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}
}
