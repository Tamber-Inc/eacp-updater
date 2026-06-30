#include <eacp/Graphics/Graphics.h>
#include <eacp/Network/HTTP/Http.h>
#include <eacp/Updater/Updater.h>

#include <Miro/Miro.h>

#include <iostream>
#include <string>

#ifndef EACP_REAL_UPDATE_DEMO_VERSION
#define EACP_REAL_UPDATE_DEMO_VERSION "0.0.0"
#endif

#ifndef EACP_REAL_UPDATE_DEMO_MANIFEST_URL
#define EACP_REAL_UPDATE_DEMO_MANIFEST_URL \
    "https://github.com/Tamber-Inc/eacp-updater/releases/download/remote-demo-v1/manifest.json"
#endif

namespace Graphics = eacp::Graphics;
namespace HTTP = eacp::HTTP;
namespace Updater = eacp::Updater;

namespace
{
constexpr std::string_view defaultManifestUrl =
    EACP_REAL_UPDATE_DEMO_MANIFEST_URL;

std::string downloadText(std::string_view url)
{
    auto response = HTTP::Request(std::string(url)).perform();
    if (response.statusCode < 200 || response.statusCode >= 300)
        return {};

    return response.content;
}

std::string updateStatusText()
{
    auto manifestText = downloadText(defaultManifestUrl);
    if (manifestText.empty())
        return "Update check failed";

    auto manifest = Updater::RemoteAppManifest();
    try
    {
        Miro::fromJSONString(manifest, manifestText);
    }
    catch (...)
    {
        return "Update manifest is invalid";
    }

    if (Updater::isNewerVersion(manifest.version, EACP_REAL_UPDATE_DEMO_VERSION))
        return "Update available: " + manifest.version;

    return "Up to date: " + std::string(EACP_REAL_UPDATE_DEMO_VERSION);
}

struct DemoView final : Graphics::View
{
    DemoView()
    {
        background->setFillColor({0.08f, 0.09f, 0.10f});
        title->setColor({0.94f, 0.96f, 0.96f});
        version->setColor({0.64f, 0.72f, 0.74f});
        status->setColor({0.53f, 0.82f, 0.76f});
        manifest->setColor({0.45f, 0.49f, 0.52f});

        version->setText("Installed version: " EACP_REAL_UPDATE_DEMO_VERSION);
        status->setText("Choose App > Check for Updates");
        manifest->setText(std::string("Feed: ") + std::string(defaultManifestUrl));

        addChildren({background, title, version, status, manifest});
    }

    void setStatus(const std::string& text)
    {
        status->setText(text);
        repaint();
    }

    void resized() override
    {
        auto bounds = getLocalBounds();

        auto path = Graphics::Path();
        path.addRect(bounds);
        background->setPath(path);

        scaleToFit({background, title, version, status, manifest});
        title->setPosition({28.f, bounds.h - 54.f});
        version->setPosition({28.f, bounds.h - 92.f});
        status->setPosition({28.f, bounds.h - 132.f});
        manifest->setPosition({28.f, 32.f});
    }

    Graphics::ShapeLayerView background;
    Graphics::TextLayerView title {"Tamber Demo App"};
    Graphics::TextLayerView version;
    Graphics::TextLayerView status;
    Graphics::TextLayerView manifest;
};

struct DemoGuiApp
{
    DemoGuiApp()
    {
        window.setContentView(view);
        window.toFront();

        auto appMenu = Graphics::Menu("App");
        appMenu.add(Graphics::MenuItem::withAction(
            "Check for Updates",
            [this]
            {
                view.setStatus("Checking...");
                view.setStatus(updateStatusText());
            }));
        appMenu.addSeparator();
        appMenu.add(Graphics::MenuItem::withAction("Quit", [] { eacp::Apps::quit(); }));

        auto bar = Graphics::MenuBar();
        bar.add(std::move(appMenu));
        Graphics::setApplicationMenuBar(bar);
    }

    static Graphics::WindowOptions windowOptions()
    {
        auto options = Graphics::WindowOptions();
        options.title = "Tamber Demo App";
        options.width = 520;
        options.height = 260;
        options.minWidth = 420;
        options.minHeight = 220;
        return options;
    }

    DemoView view;
    Graphics::Window window {windowOptions()};
};
} // namespace

int main(int argc, char* argv[])
{
    if (argc > 1 && std::string(argv[1]) == "--version")
    {
        std::cout << EACP_REAL_UPDATE_DEMO_VERSION << "\n";
        return 0;
    }

    if (argc > 1 && std::string(argv[1]) == "--check-updates")
    {
        std::cout << updateStatusText() << "\n";
        return 0;
    }

    eacp::Apps::run<DemoGuiApp>(argc, argv);
    return 0;
}
