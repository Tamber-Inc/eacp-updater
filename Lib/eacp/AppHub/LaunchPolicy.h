#pragma once

#include <eacp/AppHub/AppHubTypes.h>
#include <eacp/Updater/Updater.h>

namespace eacp::AppHub
{

LaunchCheckResult evaluateLaunchPolicy(
    const LaunchCheckRequest& request,
    const eacp::Updater::ProductCatalog& catalog,
    const eacp::Vector<eacp::Updater::ProductReceipt>& receipts);

} // namespace eacp::AppHub
