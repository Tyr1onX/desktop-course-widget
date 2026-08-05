import subprocess

subprocess.run(["python", "scripts/apply_weekday_header_fix.py"], check=True)
subprocess.run(
    ["git", "checkout", "--", ".github/workflows/release-build.yml"],
    check=True,
)
