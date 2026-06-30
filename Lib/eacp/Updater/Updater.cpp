#include "Updater.h"

#include <eacp/Core/Utils/SHA256.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <set>
#include <sstream>
#include <string_view>
#include <system_error>
#include <type_traits>
#include <utility>
#include <vector>

#if !defined(_WIN32)
#include <fcntl.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>
extern char** environ;
#endif

namespace eacp::Updater
{
namespace
{
namespace fs = std::filesystem;

std::string readTextFile(const fs::path& path)
{
    auto in = std::ifstream(path, std::ios::binary);
    if (!in)
        return {};

    auto out = std::ostringstream();
    out << in.rdbuf();
    return out.str();
}

bool writeTextFile(const fs::path& path, const std::string& text)
{
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    if (ec)
        return false;

    auto out = std::ofstream(path, std::ios::binary | std::ios::trunc);
    if (!out)
        return false;

    out << text;
    return (bool) out;
}

fs::path canonicalExisting(const fs::path& path)
{
    std::error_code ec;
    auto result = fs::weakly_canonical(path, ec);
    return ec ? fs::absolute(path) : result;
}

std::string productDirectoryName(const std::string& id)
{
    return id;
}

std::string nowUtcForReceipt()
{
    auto now = std::chrono::system_clock::now();
    auto time = std::chrono::system_clock::to_time_t(now);
    auto tm = std::tm {};

#if defined(_WIN32)
    gmtime_s(&tm, &time);
#else
    gmtime_r(&time, &tm);
#endif

    auto out = std::ostringstream();
    out << std::put_time(&tm, "%Y-%m-%dT%H:%M:%SZ");
    return out.str();
}

Vector<int> versionParts(const std::string& version)
{
    auto result = Vector<int>();
    auto current = std::string();

    auto flush = [&]
    {
        if (current.empty())
        {
            result.add(0);
            return;
        }

        try
        {
            result.add(std::stoi(current));
        }
        catch (...)
        {
            result.add(0);
        }
        current.clear();
    };

    for (auto c: version)
    {
        if (std::isdigit(static_cast<unsigned char>(c)))
            current.push_back(c);
        else
            flush();
    }

    flush();
    return result;
}

std::string artifactPathFor(const std::string& directory,
                            const std::string& productId)
{
    return (fs::path(directory) / (productDirectoryName(productId) + ".artifact"))
        .string();
}

fs::path applicationPathFor(const fs::path& root, const std::string& productId)
{
    return root / "Applications" / productDirectoryName(productId);
}

fs::path receiptPathFor(const fs::path& root, const std::string& productId)
{
    return root / "receipts" / (productDirectoryName(productId) + ".json");
}

fs::path installStagingPathFor(const fs::path& root, const std::string& productId)
{
    return root / "install-staging" / productDirectoryName(productId);
}

fs::path rollbackPathFor(const fs::path& root, const std::string& productId)
{
    return root / "rollback" / productDirectoryName(productId);
}

bool atomicWriteTextFile(const fs::path& path, const std::string& text)
{
    auto temp = path;
    temp += ".tmp";

    if (!writeTextFile(temp, text))
        return false;

    std::error_code ec;
    fs::rename(temp, path, ec);
    if (!ec)
        return true;

    fs::remove(path, ec);
    ec.clear();
    fs::rename(temp, path, ec);
    return !ec;
}

struct PreparedOperation
{
    PlanOperation request;
    fs::path productDir;
    fs::path receiptPath;
    fs::path installStagingDir;
    fs::path rollbackDir;
    ProductReceipt receipt;
};

InstallResult ok()
{
    auto result = InstallResult();
    result.ok = true;
    return result;
}

InstallResult error(std::string message)
{
    auto result = InstallResult();
    result.ok = false;
    result.error = std::move(message);
    return result;
}

#if !defined(_WIN32)
struct ProcessOutput
{
    bool ok = false;
    std::string output;
};

ProcessOutput runProcessCapture(const std::vector<std::string>& args)
{
    auto result = ProcessOutput();
    if (args.empty())
        return result;

    int pipeFds[2] = {-1, -1};
    if (::pipe(pipeFds) != 0)
        return result;

    auto actions = posix_spawn_file_actions_t();
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, pipeFds[1], STDOUT_FILENO);
    posix_spawn_file_actions_adddup2(&actions, pipeFds[1], STDERR_FILENO);
    posix_spawn_file_actions_addclose(&actions, pipeFds[0]);
    posix_spawn_file_actions_addclose(&actions, pipeFds[1]);

    auto argv = std::vector<char*>();
    argv.reserve(args.size() + 1);
    for (const auto& arg: args)
        argv.push_back(const_cast<char*>(arg.c_str()));
    argv.push_back(nullptr);

    auto pid = pid_t {};
    auto status = posix_spawnp(&pid,
                               argv[0],
                               &actions,
                               nullptr,
                               argv.data(),
                               environ);
    posix_spawn_file_actions_destroy(&actions);
    ::close(pipeFds[1]);

    if (status != 0)
    {
        ::close(pipeFds[0]);
        return result;
    }

    auto buffer = std::array<char, 4096>();
    while (true)
    {
        auto readCount = ::read(pipeFds[0], buffer.data(), buffer.size());
        if (readCount <= 0)
            break;
        result.output.append(buffer.data(), static_cast<std::size_t>(readCount));
    }
    ::close(pipeFds[0]);

    auto waitStatus = 0;
    if (::waitpid(pid, &waitStatus, 0) < 0)
        return result;

    result.ok = WIFEXITED(waitStatus) && WEXITSTATUS(waitStatus) == 0;
    return result;
}

bool runProcess(const std::vector<std::string>& args)
{
    return runProcessCapture(args).ok;
}
#endif

std::string trimWhitespace(std::string value)
{
    while (!value.empty()
           && std::isspace(static_cast<unsigned char>(value.back())))
        value.pop_back();
    auto first = std::size_t {};
    while (first < value.size()
           && std::isspace(static_cast<unsigned char>(value[first])))
        ++first;
    return value.substr(first);
}

bool hasDuplicateProductOperation(const InstallPlan& plan,
                                  const std::string& productId)
{
    auto count = 0;
    for (const auto& op: plan.operations)
        if (op.productId == productId)
            ++count;

    return count > 1;
}

Target makeTarget(Platform platform, Architecture architecture)
{
    auto target = Target();
    target.platform = platform;
    target.architecture = architecture;
    return target;
}

PlanOperation makeOperation(PlanAction action,
                            const std::string& productId,
                            const std::string& name = {},
                            const std::string& channel = {},
                            const std::string& version = {},
                            const std::string& artifactPath = {},
                            const std::string& artifactSha256 = {})
{
    auto operation = PlanOperation();
    operation.action = action;
    operation.productId = productId;
    operation.name = name;
    operation.channel = channel;
    operation.version = version;
    operation.artifactPath = artifactPath;
    operation.artifactSha256 = artifactSha256;
    return operation;
}

const Miro::Json::Object* objectOrNull(const Miro::JSON& value)
{
    return value.isObject() ? &value.asObject() : nullptr;
}

const Miro::Json::Array* arrayOrNull(const Miro::JSON& value)
{
    return value.isArray() ? &value.asArray() : nullptr;
}

const Miro::JSON* findJson(const Miro::Json::Object& object,
                           std::string_view key)
{
    return Miro::Json::find(object, key);
}

std::string readString(const Miro::Json::Object& object,
                       std::string_view key,
                       std::string fallback = {})
{
    if (const auto* value = findJson(object, key))
        if (value->isString())
            return value->asString();

    return fallback;
}

int readInt(const Miro::Json::Object& object,
            std::string_view key,
            int fallback = 0)
{
    if (const auto* value = findJson(object, key))
        if (value->isNumber())
            return static_cast<int>(value->asNumber());

    return fallback;
}

template <typename Enum>
Enum readEnum(const Miro::Json::Object& object,
              std::string_view key,
              Enum fallback)
{
    using Underlying = std::underlying_type_t<Enum>;

    if (const auto* value = findJson(object, key))
    {
        if (value->isString())
            if (auto parsed = Miro::enumFromString<Enum>(value->asString()))
                return *parsed;

        if (value->isNumber())
            return static_cast<Enum>(
                static_cast<Underlying>(static_cast<int>(value->asNumber())));
    }

    return fallback;
}

Vector<std::string> readStringArray(const Miro::Json::Object& object,
                                    std::string_view key)
{
    auto result = Vector<std::string>();

    const auto* value = findJson(object, key);
    if (value == nullptr)
        return result;

    const auto* array = arrayOrNull(*value);
    if (array == nullptr)
        return result;

    for (const auto& item: *array)
        if (item.isString())
            result.add(item.asString());

    return result;
}

ProductArtifact readProductArtifact(const Miro::Json::Object& object)
{
    auto artifact = ProductArtifact();
    artifact.platform =
        readEnum(object, "platform", artifact.platform);
    artifact.architecture =
        readEnum(object, "architecture", artifact.architecture);
    artifact.url = readString(object, "url");
    artifact.sha256 = readString(object, "sha256");
    artifact.signature = readString(object, "signature");
    return artifact;
}

Vector<ProductArtifact> readProductArtifacts(const Miro::Json::Object& object)
{
    auto result = Vector<ProductArtifact>();

    const auto* value = findJson(object, "artifacts");
    if (value == nullptr)
        return result;

    const auto* array = arrayOrNull(*value);
    if (array == nullptr)
        return result;

    for (const auto& item: *array)
        if (const auto* artifactObject = objectOrNull(item))
            result.add(readProductArtifact(*artifactObject));

    return result;
}

Product readProduct(const Miro::Json::Object& object)
{
    auto product = Product();
    product.id = readString(object, "id");
    product.name = readString(object, "name");
    product.kind = readEnum(object, "kind", product.kind);
    product.bundleName = readString(object, "bundleName");
    product.channel = readString(object, "channel", product.channel);
    product.latestVersion = readString(object, "latestVersion");
    product.minimumLaunchVersion = readString(object, "minimumLaunchVersion");
    product.dependencies = readStringArray(object, "dependencies");
    product.artifacts = readProductArtifacts(object);
    return product;
}

Vector<Product> readProducts(const Miro::Json::Object& object)
{
    auto result = Vector<Product>();

    const auto* value = findJson(object, "products");
    if (value == nullptr)
        return result;

    const auto* array = arrayOrNull(*value);
    if (array == nullptr)
        return result;

    for (const auto& item: *array)
        if (const auto* productObject = objectOrNull(item))
            result.add(readProduct(*productObject));

    return result;
}

ProductReceipt makeReceipt(const PlanOperation& op, const fs::path& productDir)
{
    auto receipt = ProductReceipt();
    receipt.productId = op.productId;
    receipt.name = op.name;
    receipt.version = op.version;
    receipt.installPath = productDir.string();
    receipt.channel = op.channel;
    receipt.artifactSha256 = op.artifactSha256;
    receipt.installedAt = nowUtcForReceipt();
    return receipt;
}

InstallResult prepareOperation(const MockHelperOptions& options,
                               const InstallPlan& fullPlan,
                               const Vector<ProductReceipt>& receipts,
                               const PlanOperation& op,
                               PreparedOperation& out)
{
    if (!isValidProductId(op.productId))
        return error("invalid product id");

    if (hasDuplicateProductOperation(fullPlan, op.productId))
        return error("duplicate product operation");

    out.request = op;
    out.productDir = applicationPathFor(options.root, op.productId);
    out.receiptPath = receiptPathFor(options.root, op.productId);
    out.installStagingDir = installStagingPathFor(options.root, op.productId);
    out.rollbackDir = rollbackPathFor(options.root, op.productId);

    switch (op.action)
    {
        case PlanAction::Remove:
            return ok();

        case PlanAction::Install:
        case PlanAction::Update:
            break;

        default:
            return error("invalid plan action");
    }

    if (op.name.empty())
        return error("product name is required");
    if (op.version.empty())
        return error("product version is required");
    if (op.artifactSha256.empty())
        return error("artifact hash is required");

    if (!pathIsUnder(op.artifactPath, options.stagingRoot))
        return error("artifact path is outside staging root");

    auto actualHash = Crypto::sha256File(op.artifactPath);
    if (actualHash.empty())
        return error("artifact could not be read");
    if (actualHash != op.artifactSha256)
        return error("artifact hash mismatch");

    if (auto* existing = findReceipt(receipts, op.productId);
        existing != nullptr && !options.allowDowngrade
        && compareVersions(op.version, existing->version) < 0)
        return error("downgrade rejected");

    out.receipt = makeReceipt(op, out.productDir);

    return ok();
}

InstallResult preparePlan(const MockHelperOptions& options,
                          const Vector<ProductReceipt>& receipts,
                          const InstallPlan& plan,
                          Vector<PreparedOperation>& out)
{
    for (const auto& op: plan.operations)
    {
        auto prepared = PreparedOperation();
        auto result = prepareOperation(options, plan, receipts, op, prepared);
        if (!result.ok)
            return result;

        out.add(std::move(prepared));
    }

    return ok();
}

InstallResult executeRemove(const PreparedOperation& op)
{
    auto ec = std::error_code{};
    fs::remove_all(op.productDir, ec);
    if (ec)
        return error("failed to remove product");

    fs::remove(op.receiptPath, ec);
    if (ec)
        return error("failed to remove receipt");

    return ok();
}

InstallResult executeInstall(const PreparedOperation& op)
{
    auto ec = std::error_code{};
    fs::remove_all(op.installStagingDir, ec);
    fs::create_directories(op.installStagingDir, ec);
    if (ec)
        return error("failed to create install staging");

    auto artifactPath = fs::path(op.request.artifactPath);
    if (artifactPath.extension() == ".zip")
    {
#if defined(_WIN32)
        return error("zip app artifact install is not implemented on Windows yet");
#else
        if (!runProcess({"/usr/bin/ditto",
                         "-x",
                         "-k",
                         artifactPath.string(),
                         op.installStagingDir.string()}))
        {
            return error("failed to unpack app artifact");
        }
#endif
    }
    else if (fs::is_directory(artifactPath, ec))
    {
        fs::copy(artifactPath,
                 op.installStagingDir / artifactPath.filename(),
                 fs::copy_options::recursive
                     | fs::copy_options::overwrite_existing,
                 ec);
        if (ec)
            return error("failed to stage directory artifact");
    }
    else
    {
        fs::copy_file(artifactPath,
                      op.installStagingDir / "artifact.bin",
                      fs::copy_options::overwrite_existing,
                      ec);
        if (ec)
            return error("failed to stage artifact");
    }

    fs::remove_all(op.rollbackDir, ec);
    if (fs::exists(op.productDir, ec))
    {
        fs::create_directories(op.rollbackDir.parent_path(), ec);
        fs::rename(op.productDir, op.rollbackDir, ec);
        if (ec)
            return error("failed to create rollback copy");
    }

    fs::create_directories(op.productDir.parent_path(), ec);
    fs::rename(op.installStagingDir, op.productDir, ec);
    if (ec)
    {
        auto restoreEc = std::error_code();
        if (fs::exists(op.rollbackDir, restoreEc))
            fs::rename(op.rollbackDir, op.productDir, restoreEc);
        return error("failed to publish product install");
    }

    if (!atomicWriteTextFile(op.receiptPath, receiptToJson(op.receipt)))
        return error("failed to write receipt");

    return ok();
}
} // namespace

ProductCatalog parseCatalogJson(const std::string& json)
{
    auto catalog = ProductCatalog();
    auto root = Miro::Json::parse(json);

    const auto* object = objectOrNull(root);
    if (object == nullptr)
        return catalog;

    catalog.catalogVersion = readInt(*object, "catalogVersion");
    catalog.products = readProducts(*object);
    catalog.signature = readString(*object, "signature");
    return catalog;
}

std::string catalogToJson(const ProductCatalog& catalog)
{
    return Miro::toJSONString(catalog);
}

ProductReceipt parseReceiptJson(const std::string& json)
{
    auto receipt = ProductReceipt();
    Miro::fromJSONString(receipt, json);
    return receipt;
}

std::string receiptToJson(const ProductReceipt& receipt)
{
    return Miro::toJSONString(receipt);
}

InstallPlan parseInstallPlanJson(const std::string& json)
{
    auto plan = InstallPlan();
    Miro::fromJSONString(plan, json);
    return plan;
}

std::string installPlanToJson(const InstallPlan& plan)
{
    return Miro::toJSONString(plan);
}

const Product* findProduct(const ProductCatalog& catalog,
                           const std::string& productId)
{
    for (const auto& product: catalog.products)
        if (product.id == productId)
            return &product;

    return nullptr;
}

const ProductReceipt* findReceipt(const Vector<ProductReceipt>& receipts,
                                  const std::string& productId)
{
    for (const auto& receipt: receipts)
        if (receipt.productId == productId)
            return &receipt;

    return nullptr;
}

int compareVersions(const std::string& lhs, const std::string& rhs)
{
    auto left = versionParts(lhs);
    auto right = versionParts(rhs);
    auto count = std::max(static_cast<std::size_t>(left.size()),
                          static_cast<std::size_t>(right.size()));

    for (std::size_t i = 0; i < count; ++i)
    {
        auto l = i < static_cast<std::size_t>(left.size()) ? left[i] : 0;
        auto r = i < static_cast<std::size_t>(right.size()) ? right[i] : 0;
        if (l < r)
            return -1;
        if (l > r)
            return 1;
    }

    return 0;
}

bool isNewerVersion(const std::string& candidate, const std::string& current)
{
    return compareVersions(candidate, current) > 0;
}

bool isValidProductId(const std::string& productId)
{
    if (productId.empty() || productId == "." || productId == "..")
        return false;

    for (auto c: productId)
    {
        if (!std::isalnum(static_cast<unsigned char>(c)) && c != '.'
            && c != '-' && c != '_')
            return false;
    }

    return true;
}

bool isValidAppBundleName(const std::string& bundleName)
{
    constexpr auto suffix = std::string_view(".app");
    if (bundleName.size() <= suffix.size()
        || bundleName.compare(bundleName.size() - suffix.size(),
                              suffix.size(),
                              suffix) != 0)
        return false;

    for (auto c: bundleName)
    {
        if (!std::isalnum(static_cast<unsigned char>(c)) && c != ' '
            && c != '.' && c != '-' && c != '_')
            return false;
    }

    return true;
}

#if !defined(_WIN32)
namespace
{
fs::path createTemporaryDirectory(const std::string& prefix)
{
    auto pattern = (fs::temp_directory_path() / (prefix + ".XXXXXX")).string();
    auto mutablePattern = std::vector<char>(pattern.begin(), pattern.end());
    mutablePattern.push_back('\0');

    auto* result = ::mkdtemp(mutablePattern.data());
    return result == nullptr ? fs::path() : fs::path(result);
}

std::string bundleIdentifierFor(const fs::path& app)
{
    auto result =
        runProcessCapture({"/usr/libexec/PlistBuddy",
                           "-c",
                           "Print :CFBundleIdentifier",
                           (app / "Contents" / "Info.plist").string()});
    return result.ok ? trimWhitespace(result.output) : std::string();
}

std::string teamIdentifierFor(const fs::path& app)
{
    auto result =
        runProcessCapture({"/usr/bin/codesign",
                           "--display",
                           "--verbose=4",
                           app.string()});
    if (!result.ok)
        return {};

    auto input = std::istringstream(result.output);
    auto line = std::string();
    constexpr auto prefix = std::string_view("TeamIdentifier=");
    while (std::getline(input, line))
    {
        if (line.rfind(prefix, 0) == 0)
            return trimWhitespace(line.substr(prefix.size()));
    }

    return {};
}

InstallResult validateUnpackedAppBundle(
    const PrivilegedAppBundleInstallRequest& request,
    const fs::path& app)
{
    std::error_code ec;
    if (!fs::is_directory(app, ec) || fs::is_symlink(app, ec))
        return error("artifact did not contain expected app bundle");

    auto actualBundleId = bundleIdentifierFor(app);
    if (actualBundleId.empty())
        return error("app bundle identifier could not be read");
    if (actualBundleId != request.productId)
        return error("app bundle identifier mismatch");

    if (!runProcess({"/usr/bin/codesign",
                     "--verify",
                     "--strict",
                     "--verbose=2",
                     app.string()}))
        return error("app bundle code signature verification failed");

    if (!request.requiredTeamIdentifier.empty())
    {
        auto teamId = teamIdentifierFor(app);
        if (teamId != request.requiredTeamIdentifier)
            return error("app bundle team identifier mismatch");
    }

    return ok();
}
} // namespace
#endif

InstallResult installAppBundleArtifact(
    const PrivilegedAppBundleInstallRequest& request)
{
#if defined(_WIN32)
    (void) request;
    return error("privileged app bundle installs are not implemented on Windows");
#else
    if (!isValidProductId(request.productId))
        return error("invalid product id");
    if (!isValidAppBundleName(request.bundleName))
        return error("invalid app bundle name");
    if (request.artifactPath.empty())
        return error("artifact path is required");
    if (request.artifactSha256.empty())
        return error("artifact hash is required");

    auto artifact = fs::path(request.artifactPath);
    std::error_code ec;
    if (!fs::is_regular_file(artifact, ec))
        return error("artifact path is not a regular file");

    auto actualHash = Crypto::sha256File(artifact.string());
    if (actualHash.empty())
        return error("artifact could not be read");
    if (actualHash != request.artifactSha256)
        return error("artifact hash mismatch");

    auto temp = createTemporaryDirectory("eacp-privileged-install");
    if (temp.empty())
        return error("failed to create privileged install temp directory");

    auto cleanup = [&]
    {
        std::error_code cleanupEc;
        fs::remove_all(temp, cleanupEc);
    };

    auto unpack = temp / "unpack";
    fs::create_directories(unpack, ec);
    if (ec)
    {
        cleanup();
        return error("failed to create unpack directory");
    }

    if (!runProcess({"/usr/bin/ditto",
                     "-x",
                     "-k",
                     artifact.string(),
                     unpack.string()}))
    {
        cleanup();
        return error("failed to unpack artifact");
    }

    auto unpackedApp = unpack / request.bundleName;
    if (auto validation = validateUnpackedAppBundle(request, unpackedApp);
        !validation.ok)
    {
        cleanup();
        return validation;
    }

    auto installPath = fs::path("/Applications") / request.bundleName;
    auto rollbackPath =
        fs::path("/Applications") / (request.bundleName + ".rollback");

    fs::remove_all(rollbackPath, ec);
    if (ec)
    {
        cleanup();
        return error("failed to remove old rollback");
    }

    if (fs::exists(installPath, ec))
    {
        fs::rename(installPath, rollbackPath, ec);
        if (ec)
        {
            cleanup();
            return error("failed to create rollback");
        }
    }

    fs::rename(unpackedApp, installPath, ec);
    if (ec
        && !runProcess({"/usr/bin/ditto",
                        unpackedApp.string(),
                        installPath.string()}))
    {
        auto restoreEc = std::error_code();
        fs::remove_all(installPath, restoreEc);
        restoreEc.clear();
        if (fs::exists(rollbackPath, restoreEc))
            fs::rename(rollbackPath, installPath, restoreEc);
        cleanup();
        return error("failed to install app");
    }

    cleanup();
    return ok();
#endif
}

ProductArtifact artifactForPlatform(const Product& product, Platform platform)
{
    return artifactForTarget(product, makeTarget(platform, Architecture::Any));
}

ProductArtifact artifactForTarget(const Product& product, const Target& target)
{
    return artifactForTargetT(product, target);
}

InstallPlan planInstall(const ProductCatalog& catalog,
                        const Vector<ProductReceipt>& receipts,
                        const std::string& productId,
                        Platform platform,
                        const std::string& artifactPath)
{
    auto plan = InstallPlan();
    if (!isValidProductId(productId))
        return plan;

    auto* product = findProduct(catalog, productId);
    if (product == nullptr)
        return plan;

    auto artifact = artifactForPlatform(*product, platform);
    if (artifact.url.empty())
        return plan;

    auto action = findReceipt(receipts, productId) == nullptr
                ? PlanAction::Install
                : PlanAction::Update;

    plan.operations.add(makeOperation(action,
                                      product->id,
                                      product->name,
                                      product->channel,
                                      product->latestVersion,
                                      artifactPath,
                                      artifact.sha256));
    return plan;
}

namespace
{
void appendInstallWithDependencies(const ProductCatalog& catalog,
                                   const Vector<ProductReceipt>& receipts,
                                   const std::string& productId,
                                   const Target& target,
                                   const std::string& artifactDirectory,
                                   std::set<std::string>& visiting,
                                   std::set<std::string>& planned,
                                   InstallPlan& plan)
{
    if (!isValidProductId(productId) || planned.contains(productId)
        || visiting.contains(productId))
        return;

    auto* product = findProduct(catalog, productId);
    if (product == nullptr)
        return;

    visiting.insert(productId);
    for (const auto& dependency: product->dependencies)
        appendInstallWithDependencies(catalog,
                                      receipts,
                                      dependency,
                                      target,
                                      artifactDirectory,
                                      visiting,
                                      planned,
                                      plan);
    visiting.erase(productId);

    auto artifact = artifactForTarget(*product, target);
    if (artifact.url.empty())
        return;

    auto action = findReceipt(receipts, productId) == nullptr
                ? PlanAction::Install
                : PlanAction::Update;

    plan.operations.add(makeOperation(action,
                                      product->id,
                                      product->name,
                                      product->channel,
                                      product->latestVersion,
                                      artifactPathFor(artifactDirectory,
                                                      product->id),
                                      artifact.sha256));
    planned.insert(productId);
}
} // namespace

InstallPlan planInstallWithDependencies(const ProductCatalog& catalog,
                                        const Vector<ProductReceipt>& receipts,
                                        const std::string& productId,
                                        const Target& target,
                                        const std::string& artifactDirectory)
{
    auto plan = InstallPlan();
    auto visiting = std::set<std::string>();
    auto planned = std::set<std::string>();

    appendInstallWithDependencies(catalog,
                                  receipts,
                                  productId,
                                  target,
                                  artifactDirectory,
                                  visiting,
                                  planned,
                                  plan);
    return plan;
}

InstallPlan planUpdateProduct(const ProductCatalog& catalog,
                              const Vector<ProductReceipt>& receipts,
                              const std::string& productId,
                              Platform platform,
                              const std::string& artifactDirectory)
{
    return planUpdateProduct(catalog,
                             receipts,
                             productId,
                             makeTarget(platform, Architecture::Any),
                             artifactDirectory);
}

InstallPlan planUpdateProduct(const ProductCatalog& catalog,
                              const Vector<ProductReceipt>& receipts,
                              const std::string& productId,
                              const Target& target,
                              const std::string& artifactDirectory)
{
    auto plan = InstallPlan();
    if (!isValidProductId(productId))
        return plan;

    auto* product = findProduct(catalog, productId);
    if (product == nullptr)
        return plan;

    auto* receipt = findReceipt(receipts, productId);
    if (receipt == nullptr)
        return plan;

    if (!isNewerVersion(product->latestVersion, receipt->version))
        return plan;

    auto artifact = artifactForTarget(*product, target);
    if (artifact.url.empty())
        return plan;

    plan.operations.add(makeOperation(PlanAction::Update,
                                      product->id,
                                      product->name,
                                      product->channel,
                                      product->latestVersion,
                                      artifactPathFor(artifactDirectory,
                                                      product->id),
                                      artifact.sha256));
    return plan;
}

InstallPlan planUpdateAll(const ProductCatalog& catalog,
                          const Vector<ProductReceipt>& receipts,
                          Platform platform,
                          const std::string& artifactDirectory)
{
    auto plan = InstallPlan();

    for (const auto& product: catalog.products)
    {
        if (!isValidProductId(product.id))
            continue;

        auto* receipt = findReceipt(receipts, product.id);
        if (receipt == nullptr)
            continue;

        if (!isNewerVersion(product.latestVersion, receipt->version))
            continue;

        auto artifact = artifactForPlatform(product, platform);
        if (artifact.url.empty())
            continue;

        plan.operations.add(makeOperation(PlanAction::Update,
                                          product.id,
                                          product.name,
                                          product.channel,
                                          product.latestVersion,
                                          artifactPathFor(artifactDirectory,
                                                          product.id),
                                          artifact.sha256));
    }

    return plan;
}

InstallPlan planUpdateAll(const ProductCatalog& catalog,
                          const Vector<ProductReceipt>& receipts,
                          const Target& target,
                          const std::string& artifactDirectory)
{
    auto plan = InstallPlan();

    for (const auto& product: catalog.products)
    {
        if (!isValidProductId(product.id))
            continue;

        auto* receipt = findReceipt(receipts, product.id);
        if (receipt == nullptr)
            continue;

        if (!isNewerVersion(product.latestVersion, receipt->version))
            continue;

        auto artifact = artifactForTarget(product, target);
        if (artifact.url.empty())
            continue;

        plan.operations.add(makeOperation(PlanAction::Update,
                                          product.id,
                                          product.name,
                                          product.channel,
                                          product.latestVersion,
                                          artifactPathFor(artifactDirectory,
                                                          product.id),
                                          artifact.sha256));
    }

    return plan;
}

InstallPlan planRemove(const std::string& productId)
{
    auto plan = InstallPlan();
    if (isValidProductId(productId))
        plan.operations.add(makeOperation(PlanAction::Remove, productId));
    return plan;
}

bool pathIsUnder(const std::string& path, const std::string& root)
{
    auto canonicalPath = canonicalExisting(path);
    auto canonicalRoot = canonicalExisting(root);

    std::error_code ec;
    auto relative = fs::relative(canonicalPath, canonicalRoot, ec);
    if (ec)
        return false;

    auto generic = relative.generic_string();
    return !generic.empty() && generic != ".." && generic.rfind("../", 0) != 0;
}

MockPrivilegedHelper::MockPrivilegedHelper(MockHelperOptions optionsToUse)
    : options(std::move(optionsToUse))
{
    if (options.stagingRoot.empty())
        options.stagingRoot = (fs::path(options.root) / "staging").string();
}

bool MockPrivilegedHelper::isInstalled() const
{
    std::error_code ec;
    fs::create_directories(applicationsRoot(), ec);
    if (ec)
        return false;

    fs::create_directories(receiptsRoot(), ec);
    return !ec;
}

Vector<ProductReceipt> MockPrivilegedHelper::receipts() const
{
    auto out = Vector<ProductReceipt>();
    std::error_code ec;
    auto root = fs::path(receiptsRoot());
    if (!fs::exists(root, ec))
        return out;

    for (const auto& entry: fs::directory_iterator(root, ec))
    {
        if (ec || !entry.is_regular_file())
            continue;

        try
        {
            out.add(parseReceiptJson(readTextFile(entry.path())));
        }
        catch (...)
        {
        }
    }

    return out;
}

InstallResult MockPrivilegedHelper::submit(const InstallPlan& plan)
{
    if (!isInstalled())
        return error("helper root could not be created");

    auto prepared = Vector<PreparedOperation>();
    if (auto result = preparePlan(options, receipts(), plan, prepared); !result.ok)
        return result;

    for (const auto& op: prepared)
    {
        auto result = op.request.action == PlanAction::Remove
                    ? executeRemove(op)
                    : executeInstall(op);
        if (!result.ok)
            return result;
    }

    return ok();
}

std::string MockPrivilegedHelper::applicationsRoot() const
{
    return (fs::path(options.root) / "Applications").string();
}

std::string MockPrivilegedHelper::receiptsRoot() const
{
    return (fs::path(options.root) / "receipts").string();
}

} // namespace eacp::Updater
