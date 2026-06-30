//go:build !windows

package nuclei

import "os/exec"

func hideCmdWindow(cmd *exec.Cmd) {}
