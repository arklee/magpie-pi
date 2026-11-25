// magpie-pi supervises the pinned OpenCode host without a listening server.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	host := flag.String("host", "vendor/host.js", "pinned host script")
	bun := flag.String("bun", "bun", "Bun executable")
	state := flag.String("state", "", "absolute private state directory (required)")
	flag.Parse()
	if !filepath.IsAbs(*state) {
		fmt.Fprintln(os.Stderr, "--state must be absolute")
		os.Exit(2)
	}
	if err := os.MkdirAll(*state, 0700); err != nil {
		panic(err)
	}
	if err := os.Chmod(*state, 0700); err != nil {
		panic(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	hostPath, err := filepath.Abs(*host)
	if err != nil {
		panic(err)
	}
	cmd := exec.CommandContext(ctx, *bun, hostPath)
	cmd.Dir = *state
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	input, err := cmd.StdinPipe()
	if err != nil {
		panic(err)
	}
	if err = cmd.Start(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	go func() {
		_, _ = io.Copy(input, os.Stdin)
		input.Close()
		time.AfterFunc(2*time.Second, func() { _ = cmd.Process.Kill() })
	}()
	if err = cmd.Wait(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
