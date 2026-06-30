#include <eacp/AppHub/LaunchGuardIpc.h>
#include <eacp/Graphics/Graphics.h>

#include <iostream>
#include <string>
#include <string_view>

#ifndef EACP_REAL_UPDATE_DEMO_VERSION
#define EACP_REAL_UPDATE_DEMO_VERSION "0.0.0"
#endif

#ifndef EACP_REAL_UPDATE_DEMO_PRODUCT_ID
#define EACP_REAL_UPDATE_DEMO_PRODUCT_ID "music.tamber.RealUpdateDemo"
#endif

namespace AppHub = eacp::AppHub;
namespace Graphics = eacp::Graphics;

namespace
{
constexpr std::string_view productId = EACP_REAL_UPDATE_DEMO_PRODUCT_ID;

AppHub::LaunchGuardContext launchGuardContext()
{
    return {.productId = std::string(productId),
            .version = EACP_REAL_UPDATE_DEMO_VERSION,
            .channel = "stable"};
}

std::string launchMessage(const AppHub::LaunchCheckResult& result)
{
    return "Launch guard: " + AppHub::launchGuardMessage(result);
}

std::string& launchStatusText()
{
    static auto status = std::string("Launch guard: unchecked");
    return status;
}

struct DemoView final : Graphics::View
{
    explicit DemoView(std::string launchStatus)
    {
        background->setFillColor({0.08f, 0.09f, 0.10f});
        title->setColor({0.94f, 0.96f, 0.96f});
        subtitle->setColor({0.60f, 0.74f, 0.78f});
        guard->setColor({0.46f, 0.78f, 0.62f});

        title->setText("hello world " EACP_REAL_UPDATE_DEMO_VERSION);
        subtitle->setText(std::string("product: ") + std::string(productId));
        guard->setText(std::move(launchStatus));

        addChildren({background, title, subtitle, guard});
    }

    void resized() override
    {
        auto bounds = getLocalBounds();

        auto path = Graphics::Path();
        path.addRect(bounds);
        background->setPath(path);

        scaleToFit({background, title, subtitle, guard});
        title->setPosition({28.f, bounds.h - 72.f});
        subtitle->setPosition({28.f, bounds.h - 112.f});
        guard->setPosition({28.f, 34.f});
    }

    Graphics::ShapeLayerView background;
    Graphics::TextLayerView title;
    Graphics::TextLayerView subtitle;
    Graphics::TextLayerView guard;
};

struct DemoGuiApp
{
    DemoGuiApp()
        : view(launchStatusText())
    {
        window.setContentView(view);
        window.toFront();

        auto appMenu = Graphics::Menu("App");
        appMenu.add(Graphics::MenuItem::withAction("Quit", [] { eacp::Apps::quit(); }));

        auto bar = Graphics::MenuBar();
        bar.add(std::move(appMenu));
        Graphics::setApplicationMenuBar(bar);
    }

    static Graphics::WindowOptions windowOptions()
    {
        auto options = Graphics::WindowOptions();
        options.title = "Hello World Demo";
        options.width = 480;
        options.height = 220;
        options.minWidth = 360;
        options.minHeight = 180;
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

    if (argc > 1 && std::string(argv[1]) == "--launch-check")
    {
        std::cout << AppHub::launchCheckResultToString(
                         AppHub::checkLaunch(launchGuardContext()))
                  << "\n";
        return 0;
    }

    auto launchPolicy = AppHub::checkLaunch(launchGuardContext());
    if (AppHub::shouldAbortLaunch(launchPolicy))
    {
        std::cout << launchMessage(launchPolicy) << "\n";
        return 1;
    }
    launchStatusText() = launchMessage(launchPolicy);

    eacp::Apps::run<DemoGuiApp>(argc, argv);
    return 0;
}
