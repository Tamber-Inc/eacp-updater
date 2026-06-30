#include "PrivilegedHelper.h"

#include <Miro/Miro.h>

#import <Foundation/Foundation.h>
#import <Security/Authorization.h>
#import <ServiceManagement/ServiceManagement.h>

#include <iostream>
#include <utility>

@protocol EACPPrivilegedAppBundleHelperProtocol
- (void)invokeCommand:(NSString*)command
              payload:(NSString*)payload
            withReply:(void (^)(NSString* reply))reply;
@end

namespace eacp::Updater
{
namespace PrivilegedHelperDetail
{
std::string activeAllowedTeamIdentifier;

std::string stringFromCFString(CFStringRef value)
{
    if (value == nullptr)
        return {};

    auto length = CFStringGetLength(value);
    auto maxSize =
        CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    auto buffer = std::string(static_cast<std::size_t>(maxSize), '\0');
    if (!CFStringGetCString(value,
                            buffer.data(),
                            maxSize,
                            kCFStringEncodingUTF8))
        return {};

    buffer.resize(std::char_traits<char>::length(buffer.c_str()));
    return buffer;
}

std::string stringFromCFError(CFErrorRef error)
{
    if (error == nullptr)
        return {};

    auto description = CFErrorCopyDescription(error);
    auto out = stringFromCFString(description);
    if (description != nullptr)
        CFRelease(description);
    return out;
}

NSString* nsString(const std::string& value)
{
    return [NSString stringWithUTF8String:value.c_str()];
}

std::string stringFromNSString(NSString* value)
{
    if (value == nil)
        return {};
    return {[value UTF8String]};
}

CFStringRef copyCFString(const std::string& value)
{
    return CFStringCreateWithCString(nullptr,
                                     value.c_str(),
                                     kCFStringEncodingUTF8);
}

InstallResult handleInstallAppBundle(const std::string& payload)
{
    auto request = PrivilegedAppBundleInstallRequest();
    Miro::fromJSONString(request, payload);

    request.requiredTeamIdentifier = activeAllowedTeamIdentifier;
    return installAppBundleArtifact(request);
}

InstallResult handleCommand(const std::string& command,
                            const std::string& payload)
{
    if (command == "installAppBundle")
        return handleInstallAppBundle(payload);

    auto result = InstallResult();
    result.ok = false;
    result.error = "unknown privileged helper command";
    return result;
}

} // namespace PrivilegedHelperDetail

PrivilegedHelperInstallResult installPrivilegedHelper(std::string helperLabel)
{
    auto result = PrivilegedHelperInstallResult();

    AuthorizationRef auth = nullptr;
    auto status = AuthorizationCreate(nullptr,
                                      kAuthorizationEmptyEnvironment,
                                      kAuthorizationFlagDefaults,
                                      &auth);
    if (status != errAuthorizationSuccess)
    {
        result.error = "AuthorizationCreate failed";
        return result;
    }

    AuthorizationItem right = {
        kSMRightBlessPrivilegedHelper,
        0,
        nullptr,
        0,
    };
    AuthorizationRights rights = {1, &right};
    auto flags = static_cast<AuthorizationFlags>(
        kAuthorizationFlagDefaults | kAuthorizationFlagInteractionAllowed
        | kAuthorizationFlagPreAuthorize | kAuthorizationFlagExtendRights);

    status = AuthorizationCopyRights(auth,
                                     &rights,
                                     kAuthorizationEmptyEnvironment,
                                     flags,
                                     nullptr);
    if (status != errAuthorizationSuccess)
    {
        AuthorizationFree(auth, kAuthorizationFlagDefaults);
        result.error = "AuthorizationCopyRights failed";
        return result;
    }

    CFErrorRef error = nullptr;
    auto label = PrivilegedHelperDetail::copyCFString(helperLabel);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    auto blessed = SMJobBless(kSMDomainSystemLaunchd, label, auth, &error);
#pragma clang diagnostic pop
    if (label != nullptr)
        CFRelease(label);
    AuthorizationFree(auth, kAuthorizationFlagDefaults);

    if (!blessed)
    {
        result.error = "SMJobBless failed";
        auto description = PrivilegedHelperDetail::stringFromCFError(error);
        if (error != nullptr)
            CFRelease(error);
        if (!description.empty())
            result.error += ": " + description;
        return result;
    }

    result.ok = true;
    return result;
}

InstallResult installAppBundleWithPrivilegedHelper(
    std::string helperLabel,
    const PrivilegedAppBundleInstallRequest& request)
{
    auto connection =
        [[NSXPCConnection alloc] initWithMachServiceName:PrivilegedHelperDetail::nsString(helperLabel)
                                                 options:NSXPCConnectionPrivileged];
    connection.remoteObjectInterface =
        [NSXPCInterface interfaceWithProtocol:
                            @protocol(EACPPrivilegedAppBundleHelperProtocol)];

    __block auto result = InstallResult();
    result.ok = false;
    result.error = "privileged helper did not reply";

    auto semaphore = dispatch_semaphore_create(0);
    connection.invalidationHandler = ^{
      if (!result.ok && result.error == "privileged helper did not reply")
          result.error = "privileged helper connection invalidated";
      dispatch_semaphore_signal(semaphore);
    };
    connection.interruptionHandler = ^{
      if (!result.ok)
          result.error = "privileged helper connection interrupted";
      dispatch_semaphore_signal(semaphore);
    };
    [connection resume];

    auto payload = Miro::toJSONString(request);
    id remote = [connection remoteObjectProxyWithErrorHandler:^(NSError* error) {
      result.error = "privileged helper connection failed: "
                   + PrivilegedHelperDetail::stringFromNSString(error.localizedDescription);
      dispatch_semaphore_signal(semaphore);
    }];

    [(id<EACPPrivilegedAppBundleHelperProtocol>) remote
        invokeCommand:@"installAppBundle"
              payload:PrivilegedHelperDetail::nsString(payload)
            withReply:^(NSString* reply) {
              try
              {
              Miro::fromJSONString(result,
                                   PrivilegedHelperDetail::stringFromNSString(
                                       reply));
              }
              catch (const std::exception& e)
              {
                  result.ok = false;
                  result.error = std::string("invalid privileged helper reply: ")
                               + e.what();
              }
              dispatch_semaphore_signal(semaphore);
            }];

    auto timeout =
        dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(120 * NSEC_PER_SEC));
    if (dispatch_semaphore_wait(semaphore, timeout) != 0)
    {
        result.ok = false;
        result.error = "privileged helper timed out";
    }

    [connection invalidate];
    return result;
}

} // namespace eacp::Updater

@interface EACPPrivilegedAppBundleHelper
    : NSObject <EACPPrivilegedAppBundleHelperProtocol>
@end

@implementation EACPPrivilegedAppBundleHelper
- (void)invokeCommand:(NSString*)command
              payload:(NSString*)payload
            withReply:(void (^)(NSString* reply))reply
{
    auto result = eacp::Updater::InstallResult();
    try
    {
        result = eacp::Updater::PrivilegedHelperDetail::handleCommand(
            eacp::Updater::PrivilegedHelperDetail::stringFromNSString(command),
            eacp::Updater::PrivilegedHelperDetail::stringFromNSString(payload));
    }
    catch (const std::exception& e)
    {
        result.ok = false;
        result.error = e.what();
    }
    catch (...)
    {
        result.ok = false;
        result.error = "unknown privileged helper error";
    }

    reply(eacp::Updater::PrivilegedHelperDetail::nsString(
        Miro::toJSONString(result)));
}
@end

@interface EACPPrivilegedAppBundleHelperDelegate
    : NSObject <NSXPCListenerDelegate>
@end

@implementation EACPPrivilegedAppBundleHelperDelegate
- (BOOL)listener:(NSXPCListener*)listener
    shouldAcceptNewConnection:(NSXPCConnection*)connection
{
    (void) listener;

    connection.exportedInterface =
        [NSXPCInterface interfaceWithProtocol:
                            @protocol(EACPPrivilegedAppBundleHelperProtocol)];
    connection.exportedObject = [EACPPrivilegedAppBundleHelper new];
    [connection resume];
    return YES;
}
@end

namespace eacp::Updater
{

int runPrivilegedAppBundleHelper(std::string helperLabel,
                                 std::string allowedTeamIdentifier,
                                 int argc,
                                 char* argv[])
{
    if (argc > 1 && std::string(argv[1]) == "--version")
    {
        std::cout << helperLabel << " 1.0.0\n";
        return 0;
    }

    PrivilegedHelperDetail::activeAllowedTeamIdentifier = std::move(allowedTeamIdentifier);

    @autoreleasepool
    {
        auto* delegate = [EACPPrivilegedAppBundleHelperDelegate new];
        auto* listener = [[NSXPCListener alloc] initWithMachServiceName:
                                                  PrivilegedHelperDetail::nsString(helperLabel)];
        listener.delegate = delegate;
        [listener resume];
        [[NSRunLoop currentRunLoop] run];
    }

    return 0;
}

} // namespace eacp::Updater
