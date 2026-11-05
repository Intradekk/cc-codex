# Local Windows build

Commands for this checkout: `E:\cc-codex`. Run them in PowerShell.

## Rebuild and open with one command each

```powershell
E:\cc-codex\build-cc.cmd
cc
```

`build-cc.cmd` builds the native debug CLI in `codex-rs/target/debug` using
the installed Rust toolchain. It can be called from any directory. It preserves
the lockfile and returns a nonzero exit code if the build fails. Close any CLI
running from this executable before rebuilding it on Windows.

The project `cc.cmd` runs this local executable and forwards its arguments.
The existing `%APPDATA%\npm\cc.cmd` entry forwards to the project launcher,
so `cc` remains available through the existing PATH. Neither launcher changes
the working directory: the CLI opens in the folder where `cc` was called.
For example, `cc --version` checks the local build's version.

The new rebuild script was successfully run from `E:\`, outside the project;
the cached build completed in 1 minute 16 seconds. The global `cc` command was
checked from that directory with `--version`, a quoted configuration argument,
and an invalid option. Successful calls returned `0`; the invalid option's
exit code `2` was preserved. The previous global shortcut is backed up at
`codex-rs/target/cc-global.before-local.cmd`.

The wrapper checks can be repeated without rebuilding Codex:

```powershell
Set-Location E:\cc-codex
python scripts/test_cc_cmd.py
```

All 3 checks passed. They cover working-directory preservation, nonzero exit
codes, a missing executable, and a failed Cargo build in a temporary fixture.

## One-time tool installation

The repository pins Rust 1.95.0 in `codex-rs/rust-toolchain.toml`.
These installer commands were started for the local build:

```powershell
winget install --id Rustlang.Rustup --exact --source winget --accept-source-agreements --accept-package-agreements --silent --override "-y --default-toolchain 1.95.0 --profile minimal"
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --source winget --accept-source-agreements --accept-package-agreements --silent --override "--wait --quiet --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
& "$env:USERPROFILE\.cargo\bin\rustup.exe" component add --toolchain 1.95.0 rustfmt clippy rust-src
```

Wait for both installers to finish before compiling. Build Tools installs MSVC
and the Windows SDK. Installing tools alone does not update the npm Codex.

The first build stopped while extracting a V8 submodule because its filename
exceeded the Windows path limit. Windows long paths were already enabled on
this machine. The additional Git setting applied before retrying was:

```powershell
git config --global core.longpaths true
```

The next attempt found an existing version mismatch: the manifests declare
workspace version `0.166.0`, while the lockfile listed `0.0.0` for local packages.
The following commands were used once to inspect and repair that mismatch:

```powershell
Set-Location E:\cc-codex\codex-rs
& "$env:USERPROFILE\.cargo\bin\cargo.exe" update --workspace --offline --dry-run
Copy-Item -LiteralPath Cargo.lock -Destination target\Cargo.lock.before-local-build
& "$env:USERPROFILE\.cargo\bin\cargo.exe" update --workspace --offline
```

A parsed comparison against the backup confirmed that only the version fields
of 170 local packages changed. External package entries were unchanged. This
repair does not need to be repeated for the current checkout.

## Build the modified CLI

The build command actually launched for this task was
`cargo build --locked -p codex-cli --bin codex --jobs 4`.
The complete invocation, including the log, is:

```powershell
Set-Location E:\cc-codex\codex-rs
$env:CARGO_NET_GIT_FETCH_WITH_CLI = "true"
$env:GIT_TERMINAL_PROMPT = "0"
$env:LIBSQLITE3_FLAGS = "SQLITE_DISABLE_INTRINSIC"
New-Item -ItemType Directory -Force -Path target | Out-Null
& "$env:USERPROFILE\.cargo\bin\cargo.exe" build --locked -p codex-cli --bin codex --jobs 4 2>&1 | Tee-Object -FilePath target\statusline-build.log
$LASTEXITCODE
```

An exit code of `0` means the build succeeded. The expected executable is
`E:\cc-codex\codex-rs\target\debug\codex.exe`, unless `CARGO_TARGET_DIR` is
overridden. `--locked` prevents Cargo from changing the dependency lockfile.
The first build downloads dependencies; even this package-specific command can
fetch Git sources and submodules needed to resolve the shared workspace.

A preliminary `cargo fetch --locked` was also launched, then interrupted when
it started downloading dependencies for the whole workspace. It is not a
required separate step when repeating the build.

## Launch

After a successful build:

```powershell
Set-Location E:\cc-codex
.\codex-rs\target\debug\codex.exe --version
.\codex-rs\target\debug\codex.exe
```

Inside this modified CLI, enter `/statusline claude` to enable the new layout
for the session, or select `claude` through `/statusline` to save the selection.
The `cc` command launches this local build through the project `cc.cmd`.

## Targeted status-line tests

```powershell
Set-Location E:\cc-codex\codex-rs
$env:RUST_MIN_STACK = "8388608"
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test --locked -p codex-tui --lib claude_status_line --jobs 4
```

`RUST_MIN_STACK` matches the test environment in the repository's `justfile`.

## Verified build result

The CLI build completed successfully in the `dev` profile. Cargo reported
`Finished dev profile [unoptimized + debuginfo]` after 16 minutes 37 seconds.
The resulting executable is `codex-rs/target/debug/codex.exe`.
Both `codex.exe --version` and `codex.exe --help` exited successfully;
the version output was `codex-cli 0.166.0`.

The targeted Cargo test command completed successfully: 4 tests passed, with
no failures. Its first test-profile compilation took 12 minutes 4 seconds.
The existing renderer and preview tests were then run against that compiled
test executable, without another compilation:

```powershell
Set-Location E:\cc-codex\codex-rs
$env:RUST_MIN_STACK = "8388608"
& ".\target\debug\deps\codex_tui-b26b14dbbbf6f0ac.exe" bottom_pane::status_line_style::tests
& ".\target\debug\deps\codex_tui-b26b14dbbbf6f0ac.exe" chatwidget::tests::status_surface_previews
```

The renderer group passed all 9 tests; the preview group passed all 25 tests,
including its saved UI snapshots. Two of the new tests also belong to the
preview group. The test executable's hash suffix can change after rebuilding.
Logs are in `codex-rs/target/statusline-tests.log`,
`codex-rs/target/statusline-style-tests.log`, and
`codex-rs/target/statusline-preview-tests.log`.

The complete repository test suite and a manual interactive TUI session were
not run. The npm Codex installation was not replaced. Its separate `cc.cmd`
shortcut now forwards to the project launcher.

The commands in this document describe how to repeat the work. Build and test
results must be checked in their actual output; listing a command is not proof
that it passed.
