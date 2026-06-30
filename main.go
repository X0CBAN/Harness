package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"github.com/harness-proxy/harness/internal/proxy"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := proxy.NewApp()

	err := wails.Run(&options.App{
		Title:     "Harness",
		Width:     1440,
		Height:    900,
		MinWidth:  900,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour:         &options.RGBA{R: 13, G: 13, B: 15, A: 1},
		EnableDefaultContextMenu: true,
		OnStartup:                app.Startup,
		OnDomReady:               app.DomReady,
		OnShutdown:               app.Shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		panic(err)
	}
}
