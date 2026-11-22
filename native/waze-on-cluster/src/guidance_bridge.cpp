// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Robert Nisipeanu
/*
 * woc-guidance: minimal vsomeip3 bridge for BMW GuidanceEventList
 * (service 0xfb1b, instance 0x0080, major 5).
 *
 * Runs as a child of waze-on-cluster-hud.service (User=hmi_5000, which is
 * whitelisted for 0xfb1b in /etc/vsomeip/5000_5000/vsomeip_security.json).
 *
 * Line protocol (stdin -> stdout, flushed per line):
 *   stdin:  <id> <method_hex> <payload_hex>\n
 *   stdout: avail <0|1>\n
 *           reply <id> <method_hex> <rc_hex> <payload_hex>\n
 *           err <id> <message>\n
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include <atomic>
#include <csignal>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include <vsomeip/vsomeip.hpp>

namespace {

const vsomeip::service_t kService = 0xfb1b;
const vsomeip::instance_t kInstance = 0x0080;
const vsomeip::major_version_t kMajor = 5;

std::atomic<bool> g_stop(false);
std::mutex g_out_mu;
std::mutex g_pend_mu;
std::map<vsomeip::session_t, uint64_t> g_pending;
std::atomic<bool> g_avail(false);

void on_signal(int) { g_stop.store(true); }

void emit_line(const std::string &line)
{
    std::lock_guard<std::mutex> lk(g_out_mu);
    fwrite(line.data(), 1, line.size(), stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

std::string to_hex(const uint8_t *p, size_t n)
{
    static const char kHex[] = "0123456789abcdef";
    std::string out;
    out.resize(n * 2);
    for (size_t i = 0; i < n; i++) {
        out[i * 2] = kHex[p[i] >> 4];
        out[i * 2 + 1] = kHex[p[i] & 0xf];
    }
    return out;
}

bool from_hex(const std::string &s, std::vector<uint8_t> *out)
{
    if (s == "-" || s.empty()) {
        out->clear();
        return true;
    }
    if (s.size() % 2 != 0)
        return false;
    out->resize(s.size() / 2);
    auto nib = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    for (size_t i = 0; i < out->size(); i++) {
        const int hi = nib(s[i * 2]), lo = nib(s[i * 2 + 1]);
        if (hi < 0 || lo < 0)
            return false;
        (*out)[i] = uint8_t((hi << 4) | lo);
    }
    return true;
}

}  // namespace

int main()
{
    std::signal(SIGINT, on_signal);
    std::signal(SIGTERM, on_signal);
    std::signal(SIGPIPE, SIG_IGN);

    auto rt = vsomeip::runtime::get();
    auto app = rt ? rt->create_application("woc-guidance") : nullptr;
    if (!app || !app->init()) {
        emit_line("err 0 vsomeip_init_failed");
        return 1;
    }

    app->register_availability_handler(
        kService, kInstance,
        [](vsomeip::service_t, vsomeip::instance_t, bool up) {
            g_avail.store(up);
            emit_line(up ? "avail 1" : "avail 0");
        },
        kMajor, vsomeip::ANY_MINOR);

    app->register_message_handler(
        kService, kInstance, vsomeip::ANY_METHOD,
        [](const std::shared_ptr<vsomeip::message> &m) {
            if (!m)
                return;
            const auto mt = m->get_message_type();
            if (mt != vsomeip::message_type_e::MT_RESPONSE && mt != vsomeip::message_type_e::MT_ERROR)
                return;
            uint64_t req_id = 0;
            {
                std::lock_guard<std::mutex> lk(g_pend_mu);
                auto it = g_pending.find(m->get_session());
                if (it == g_pending.end())
                    return;
                req_id = it->second;
                g_pending.erase(it);
            }
            const auto pl = m->get_payload();
            const std::string hex =
                (pl && pl->get_data() && pl->get_length() > 0) ? to_hex(pl->get_data(), pl->get_length()) : "-";
            char head[96];
            std::snprintf(head, sizeof head, "reply %llu %04x %02x ", (unsigned long long)req_id,
                          (unsigned)m->get_method(), (unsigned)m->get_return_code());
            emit_line(std::string(head) + hex);
        });

    app->request_service(kService, kInstance, kMajor, vsomeip::ANY_MINOR);

    std::thread runner([&app] { app->start(); });

    std::string line;
    vsomeip::session_t next_session = 1;
    while (!g_stop.load() && std::getline(std::cin, line)) {
        if (line.empty())
            continue;
        std::istringstream iss(line);
        uint64_t id = 0;
        std::string method_s, hex_s;
        if (!(iss >> id >> method_s >> hex_s)) {
            emit_line("err 0 bad_request");
            continue;
        }
        unsigned long method = strtoul(method_s.c_str(), nullptr, 16);
        std::vector<uint8_t> bytes;
        if (method == 0 || method > 0x7fff || !from_hex(hex_s, &bytes)) {
            emit_line("err " + std::to_string(id) + " bad_args");
            continue;
        }
        if (!g_avail.load()) {
            emit_line("err " + std::to_string(id) + " service_unavailable");
            continue;
        }
        auto req = rt->create_request(true);
        if (!req) {
            emit_line("err " + std::to_string(id) + " create_request_failed");
            continue;
        }
        const vsomeip::session_t sess = next_session++;
        if (next_session == 0)
            next_session = 1;
        req->set_service(kService);
        req->set_instance(kInstance);
        req->set_method(vsomeip::method_t(method));
        req->set_interface_version(kMajor);
        req->set_session(sess);
        auto pl = rt->create_payload();
        if (!bytes.empty())
            pl->set_data(bytes);
        req->set_payload(pl);
        {
            std::lock_guard<std::mutex> lk(g_pend_mu);
            if (g_pending.size() > 64)
                g_pending.clear();
            g_pending[sess] = id;
        }
        app->send(req);
    }

    app->release_service(kService, kInstance);
    app->unregister_availability_handler(kService, kInstance, kMajor, vsomeip::ANY_MINOR);
    app->unregister_message_handler(kService, kInstance, vsomeip::ANY_METHOD);
    app->stop();
    if (runner.joinable())
        runner.join();
    return 0;
}
