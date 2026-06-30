#pragma once

#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <string>
#include <string_view>

namespace eacp::Crypto
{
namespace Detail
{
class SHA256
{
public:
    void update(const std::uint8_t* data, std::size_t size)
    {
        for (std::size_t i = 0; i < size; ++i)
        {
            buffer[bufferSize++] = data[i];
            bitLength += 8;
            if (bufferSize == 64)
                transform();
        }
    }

    std::array<std::uint8_t, 32> final()
    {
        buffer[bufferSize++] = 0x80;

        if (bufferSize > 56)
        {
            while (bufferSize < 64)
                buffer[bufferSize++] = 0;
            transform();
        }

        while (bufferSize < 56)
            buffer[bufferSize++] = 0;

        for (auto i = 0; i < 8; ++i)
            buffer[63 - i] = static_cast<std::uint8_t>(bitLength >> (i * 8));
        transform();

        auto digest = std::array<std::uint8_t, 32> {};
        for (auto i = 0; i < 8; ++i)
        {
            digest[i * 4] = static_cast<std::uint8_t>(state[i] >> 24);
            digest[i * 4 + 1] = static_cast<std::uint8_t>(state[i] >> 16);
            digest[i * 4 + 2] = static_cast<std::uint8_t>(state[i] >> 8);
            digest[i * 4 + 3] = static_cast<std::uint8_t>(state[i]);
        }
        return digest;
    }

private:
    static constexpr std::array<std::uint32_t, 64> k = {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
        0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
        0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
        0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
        0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
        0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
        0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
        0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
        0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

    static std::uint32_t rotr(std::uint32_t x, std::uint32_t n)
    {
        return (x >> n) | (x << (32 - n));
    }

    void transform()
    {
        auto w = std::array<std::uint32_t, 64> {};
        for (auto i = 0; i < 16; ++i)
        {
            w[i] = (static_cast<std::uint32_t>(buffer[i * 4]) << 24)
                | (static_cast<std::uint32_t>(buffer[i * 4 + 1]) << 16)
                | (static_cast<std::uint32_t>(buffer[i * 4 + 2]) << 8)
                | static_cast<std::uint32_t>(buffer[i * 4 + 3]);
        }
        for (auto i = 16; i < 64; ++i)
        {
            auto s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
            auto s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16] + s0 + w[i - 7] + s1;
        }

        auto a = state[0];
        auto b = state[1];
        auto c = state[2];
        auto d = state[3];
        auto e = state[4];
        auto f = state[5];
        auto g = state[6];
        auto h = state[7];

        for (auto i = 0; i < 64; ++i)
        {
            auto s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            auto ch = (e & f) ^ (~e & g);
            auto temp1 = h + s1 + ch + k[i] + w[i];
            auto s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            auto maj = (a & b) ^ (a & c) ^ (b & c);
            auto temp2 = s0 + maj;
            h = g;
            g = f;
            f = e;
            e = d + temp1;
            d = c;
            c = b;
            b = a;
            a = temp1 + temp2;
        }

        state[0] += a;
        state[1] += b;
        state[2] += c;
        state[3] += d;
        state[4] += e;
        state[5] += f;
        state[6] += g;
        state[7] += h;
        bufferSize = 0;
    }

    std::array<std::uint32_t, 8> state = {
        0x6a09e667,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19};
    std::array<std::uint8_t, 64> buffer = {};
    std::size_t bufferSize = 0;
    std::uint64_t bitLength = 0;
};

inline std::string toHex(const std::array<std::uint8_t, 32>& digest)
{
    auto out = std::ostringstream();
    out << std::hex << std::setfill('0');
    for (auto byte: digest)
        out << std::setw(2) << static_cast<int>(byte);
    return out.str();
}
} // namespace Detail

inline std::string sha256(std::string_view text)
{
    auto hasher = Detail::SHA256();
    hasher.update(reinterpret_cast<const std::uint8_t*>(text.data()), text.size());
    return Detail::toHex(hasher.final());
}

inline std::string sha256File(const std::string& path)
{
    auto in = std::ifstream(std::filesystem::path(path), std::ios::binary);
    if (!in)
        return {};

    auto hasher = Detail::SHA256();
    auto buffer = std::array<char, 8192> {};
    while (in)
    {
        in.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        auto count = in.gcount();
        if (count > 0)
        {
            hasher.update(reinterpret_cast<const std::uint8_t*>(buffer.data()),
                          static_cast<std::size_t>(count));
        }
    }
    return Detail::toHex(hasher.final());
}
} // namespace eacp::Crypto
