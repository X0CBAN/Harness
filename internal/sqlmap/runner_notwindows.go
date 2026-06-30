//go:build !windows

package sqlmap

import "os/exec"

func hideCmdWindow(cmd *exec.Cmd) {}
