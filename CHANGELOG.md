# Changelog

All notable changes to Tessera are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Tessera follows
[Semantic Versioning](https://semver.org/).

## [0.71.0] - 2026-10-04

First public release.

Tessera is a desktop IDE for Windows and macOS (Apple Silicon) for people who work across
several projects and several AI accounts.

- **Workspaces** with their own color and projects.
- **Native or Docker, per project.** Native (the default) runs the agent on your computer
  with the account signed in on it, shared by every workspace. Docker runs it in the
  workspace's own sandbox, seeing only that workspace's projects, with an account that
  belongs to the workspace and is never shared with another.
- **Agents side by side**, with conversation history, account usage, the context of the
  current conversation, an agent mosaic of up to six, and automatic hibernation of idle
  agents.
- **A full IDE around them**: Monaco editor and file viewers, file explorer, Git with
  history graph and editable diffs, and terminals.
- **Databases**: Oracle, PostgreSQL, SQL Server, MongoDB, Redis and SQLite, with consoles,
  a result grid, editing with confirmation, and `tdb` so agents can query without ever
  seeing a password.
- **Automatic updates** from GitHub Releases on both platforms.

Download `Tessera-0.71.0-Setup.exe` for Windows 11 (64-bit) or `Tessera-0.71.0-arm64.dmg`
for macOS 12 or later on Apple Silicon. The installers are not signed with a paid
certificate: the [README](https://github.com/NRVH/tessera#first-launch-of-an-unsigned-app)
explains how to open Tessera the first time on each system.
