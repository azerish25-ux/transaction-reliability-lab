@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "ROOT=%~dp0"
set "PROPS=%ROOT%.mvn\wrapper\maven-wrapper.properties"
if not exist "%PROPS%" (echo Missing %PROPS% 1>&2 & exit /b 1)
for /f "tokens=1,* delims==" %%A in (%PROPS%) do (
  if "%%A"=="distributionUrl" set "URL=%%B"
  if "%%A"=="distributionSha256Sum" set "EXPECTED=%%B"
)
if not defined URL (echo Missing distributionUrl 1>&2 & exit /b 1)
if not defined EXPECTED (echo Missing distributionSha256Sum 1>&2 & exit /b 1)
for %%F in ("%URL%") do set "ARCHIVE=%%~nxF"
set "DIST=%ARCHIVE:-bin.zip=%"
if defined MAVEN_USER_HOME (set "M2=%MAVEN_USER_HOME%") else (set "M2=%USERPROFILE%\.m2")
set "CACHE=%M2%\wrapper\dists\%DIST%\ledgerguard"
set "MAVEN_HOME=%CACHE%\%DIST%"
if not exist "%MAVEN_HOME%\bin\mvn.cmd" (
  set "TMP=%TEMP%\ledgerguard-maven-%RANDOM%-%RANDOM%"
  mkdir "!TMP!" || exit /b 1
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -UseBasicParsing '%URL%' -OutFile '!TMP!\%ARCHIVE%'; $h=(Get-FileHash '!TMP!\%ARCHIVE%' -Algorithm SHA256).Hash.ToLower(); if($h -ne '%EXPECTED%'){throw 'Maven distribution checksum mismatch'}; Expand-Archive '!TMP!\%ARCHIVE%' '!TMP!'; New-Item -ItemType Directory -Force '%CACHE%' | Out-Null; if(Test-Path '%MAVEN_HOME%'){Remove-Item -Recurse -Force '%MAVEN_HOME%'}; Move-Item '!TMP!\%DIST%' '%MAVEN_HOME%'; Remove-Item -Recurse -Force '!TMP!'" || exit /b 1
)
call "%MAVEN_HOME%\bin\mvn.cmd" %*
exit /b %ERRORLEVEL%
