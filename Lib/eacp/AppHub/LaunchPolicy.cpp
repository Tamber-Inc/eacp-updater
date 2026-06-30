#include "LaunchPolicy.h"

namespace eacp::AppHub
{
namespace Updater = eacp::Updater;

LaunchCheckResult evaluateLaunchPolicy(
    const LaunchCheckRequest& request,
    const Updater::ProductCatalog& catalog,
    const eacp::Vector<Updater::ProductReceipt>& receipts)
{
    auto result = LaunchCheckResult();
    result.productId = request.productId;
    result.installedVersion = request.version;
    result.hubDeepLink = "tamberhub://product/" + request.productId;

    if (request.productId.empty())
    {
        result.decision = LaunchDecision::UnknownBlock;
        result.message = "Launch check requires a product id";
        return result;
    }

    auto* product = Updater::findProduct(catalog, request.productId);
    auto* receipt = Updater::findReceipt(receipts, request.productId);

    if (result.installedVersion.empty() && receipt != nullptr)
        result.installedVersion = receipt->version;

    if (product != nullptr)
    {
        result.latestVersion = product->latestVersion;
        result.minimumLaunchVersion = product->minimumLaunchVersion;
    }

    if (product == nullptr && receipt == nullptr)
    {
        result.decision = LaunchDecision::HubRequired;
        result.message = request.productId + " is not known to AppHub";
        return result;
    }

    if (product == nullptr)
    {
        result.decision = LaunchDecision::UnknownAllow;
        result.message = "No cached catalog entry for " + request.productId;
        return result;
    }

    if (!product->minimumLaunchVersion.empty()
        && !result.installedVersion.empty()
        && Updater::isNewerVersion(product->minimumLaunchVersion,
                                   result.installedVersion))
    {
        result.decision = LaunchDecision::UpdateRequired;
        result.message = "Update required before launch";
        return result;
    }

    if (!product->latestVersion.empty() && !result.installedVersion.empty()
        && Updater::isNewerVersion(product->latestVersion,
                                   result.installedVersion))
    {
        result.decision = LaunchDecision::UpdateAvailable;
        result.message = "Update available";
        return result;
    }

    result.decision = LaunchDecision::Allow;
    result.message = "Launch allowed";
    return result;
}

} // namespace eacp::AppHub
