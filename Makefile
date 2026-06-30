.PHONY: dev build install-tools lint

# Install Wails CLI
install-tools:
	go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Run in dev mode with hot reload
dev:
	wails dev

# Build production binary
build:
	wails build

# Build for all platforms (CI)
build-all:
	wails build -platform darwin/amd64
	wails build -platform darwin/arm64
	wails build -platform linux/amd64
	wails build -platform windows/amd64

# Run Go tests
test:
	go test ./...

# Lint
lint:
	golangci-lint run ./...
