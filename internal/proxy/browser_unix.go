//go:build !windows

package proxy

import (
	"os/exec"
	"syscall"
)

func detachProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setsid: true,
	}
}

// windowsBrowserCandidates is only meaningful on Windows.
// This stub satisfies the compiler on non-Windows builds.
func windowsBrowserCandidates() []string {
	return nil
}
