#pragma once

#include "AppHubApi.h"

#include <eacp/Core/App/App.h>
#include <eacp/Graphics/Graphics.h>
#include <eacp/WebView/WebView.h>

#include <algorithm>
#include <cmath>

namespace AppHubUI
{

inline eacp::Graphics::Image makeTrayIcon()
{
    constexpr auto size = 36;
    auto image = eacp::Graphics::Image(size, size);
    auto center = (size - 1) / 2.f;

    for (auto y = 0; y < size; ++y)
    {
        for (auto x = 0; x < size; ++x)
        {
            auto dx = (static_cast<float>(x) - center) / center;
            auto dy = (static_cast<float>(y) - center) / center;
            auto radius = std::sqrt(dx * dx + dy * dy);
            auto alpha = std::clamp(1.12f - radius, 0.f, 1.f);
            if (alpha <= 0.f)
                continue;

            image.set(x, y, eacp::Graphics::Color(0.18f, 0.66f, 0.58f, alpha));
        }
    }

    return image;
}

class AppHubWebApp
{
public:
    AppHubWebApp()
    {
        eacp::Apps::setDockIconVisible(false);
        eacp::Graphics::setApplicationMenuBar(
            eacp::Graphics::buildDefaultWebViewMenuBar());

        transport.getBridge().use(api);
        for (const auto& command: workerCommands())
            transport.setCommandExecution(command,
                                          eacp::Graphics::CommandExecution::
                                              WorkerThread);

        window.setContentView(webView);
        window.setVisible(true);
        window.toFront();

        tray.setIcon(makeTrayIcon());
        tray.setTooltip("Tamber AppHub");
        tray.setMenu(createTrayMenu());
        tray.setOnClick([this] { showWindow(); });
    }

    static eacp::Graphics::WindowOptions windowOptions()
    {
        auto options = eacp::Graphics::WindowOptions();
        options.title = "Tamber AppHub";
        options.width = 1060;
        options.height = 720;
        options.minWidth = 860;
        options.minHeight = 560;
        options.isPrimary = false;
        options.onQuit = [] {};
        options.backgroundColor = eacp::Graphics::Color(0.07f, 0.08f, 0.09f);
        return options;
    }

private:
    static eacp::Vector<std::string> workerCommands()
    {
        auto commands = eacp::Vector<std::string>();
        commands.add("refresh");
        commands.add("checkUpdates");
        commands.add("installProduct");
        commands.add("openProduct");
        commands.add("closeProduct");
        commands.add("updateAll");
        commands.add("publishMockUpdate");
        commands.add("resetMock");
        commands.add("installDemoApp");
        commands.add("updateHub");
        commands.add("launchDemoApp");
        commands.add("launchHub");
        commands.add("installPrivilegedHelper");
        return commands;
    }

    eacp::Graphics::Menu createTrayMenu()
    {
        auto menu = eacp::Graphics::Menu();
        menu.add(eacp::Graphics::MenuItem::withAction("Open AppHub",
                                                      [this] { showWindow(); }));
        menu.add(eacp::Graphics::MenuItem::withAction(
            "Check for Updates", [this] { api.checkUpdates(); }));
        menu.addSeparator();
        menu.add(eacp::Graphics::MenuItem::withAction(
            "Quit", [] { eacp::Apps::quit(); }));
        return menu;
    }

    void showWindow()
    {
        window.setVisible(true);
        window.toFront();
    }

    Api::AppHubApi api;
    eacp::Graphics::WebView webView {
        eacp::Graphics::embeddedOptions("AppHubWebApp")};
    eacp::Graphics::WebViewBridge transport {webView};
    eacp::Graphics::Window window {windowOptions()};
    eacp::Graphics::TrayIcon tray;
};

} // namespace AppHubUI
