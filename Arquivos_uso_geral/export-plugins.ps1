<#
.SYNOPSIS
    Exporta todos os arquivos .tsx, .ts e .css dos plugins para um arquivo .zip.

.DESCRIPTION
    Varre os diretórios de plugins a partir da raiz do projeto, preservando a
    estrutura de pastas relativa e ignorando pastas pesadas ou desnecessárias
    (como node_modules, dist, .git), além de excluir plugins específicos.

.PARAMETER OutputFile
    Caminho ou nome do arquivo .zip final. Padrão: "plugins-export.zip" na raiz do projeto.

.PARAMETER Timestamp
    Se definido, adiciona data/hora no nome do arquivo (ex: plugins-export_20261014_193000.zip).

.PARAMETER Extensions
    Extensões de arquivos a serem incluídas. Padrão: @('.tsx', '.ts', '.css')

.PARAMETER ExcludeDirs
    Nomes de pastas a serem ignoradas na varredura.
    Padrão: @('vale-dynamic-cards-next', 'node_modules', 'dist', '.git', '.cache', 'coverage', 'build')

.PARAMETER VerboseList
    Se definido, exibe a lista de todos os arquivos adicionados ao .zip.

.EXAMPLE
    .\export-plugins.ps1

.EXAMPLE
    .\export-plugins.ps1 -Timestamp

.EXAMPLE
    .\export-plugins.ps1 -OutputFile "C:\Backups\meus-plugins.zip" -VerboseList
#>

[CmdletBinding()]
param(
    [string]$OutputFile = "plugins-export.zip",
    [switch]$Timestamp,
    [string[]]$Extensions = @('.tsx', '.ts', '.css'),
    [string[]]$ExcludeDirs = @(
        'vale-dynamic-cards-next',  # Excluído temporariamente conforme solicitado
        'node_modules',
        'dist',
        '.git',
        '.cache',
        'coverage',
        'build'
    ),
    [switch]$VerboseList
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

# Define a raiz de busca baseada na localização do script
$RootPath = $PSScriptRoot
if (-not $RootPath) {
    $RootPath = (Get-Location).Path
}

# Resolve o caminho do arquivo de saída
if (-not [System.IO.Path]::IsPathRooted($OutputFile)) {
    $OutputFile = [System.IO.Path]::Combine($RootPath, $OutputFile)
}

if ($Timestamp) {
    $dir = [System.IO.Path]::GetDirectoryName($OutputFile)
    $fileNameWithoutExt = [System.IO.Path]::GetFileNameWithoutExtension($OutputFile)
    $ext = [System.IO.Path]::GetExtension($OutputFile)
    $dateStamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $OutputFile = [System.IO.Path]::Combine($dir, "${fileNameWithoutExt}_${dateStamp}${ext}")
}

$outputDir = [System.IO.Path]::GetDirectoryName($OutputFile)
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Exportador de Codigo dos Plugins (.tsx / .ts / .css)   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Raiz do projeto : $RootPath" -ForegroundColor Gray
Write-Host "  Extensoes       : $($Extensions -join ', ')" -ForegroundColor Gray
Write-Host "  Exclusoes       : $($ExcludeDirs -join ', ')" -ForegroundColor Gray
Write-Host "  Destino (.zip)  : $OutputFile" -ForegroundColor Gray
Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray

# 1. Carrega assemblies de compactacao .NET
Add-Type -AssemblyName "System.IO.Compression"
Add-Type -AssemblyName "System.IO.Compression.FileSystem"

# 2. Localiza arquivos ignorando diretorios excluidos rapidamente
Write-Host "==> Escaneando arquivos..." -ForegroundColor Yellow

$foundFiles = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
$normalizedExts = $Extensions | ForEach-Object { $_.ToLowerInvariant() }

function Find-PluginFiles([string]$currentDir) {
    try {
        $entries = [System.IO.Directory]::EnumerateFileSystemEntries($currentDir)
        foreach ($entry in $entries) {
            if ([System.IO.Directory]::Exists($entry)) {
                $dirName = [System.IO.Path]::GetFileName($entry)
                if ($ExcludeDirs -notcontains $dirName) {
                    Find-PluginFiles $entry
                }
            } else {
                $ext = [System.IO.Path]::GetExtension($entry).ToLowerInvariant()
                if ($normalizedExts -contains $ext) {
                    $foundFiles.Add([System.IO.FileInfo]::new($entry))
                }
            }
        }
    } catch {
        Write-Warning "Nao foi possivel acessar a pasta: $currentDir ($($_.Exception.Message))"
    }
}

Find-PluginFiles $RootPath

if ($foundFiles.Count -eq 0) {
    Write-Host "Nenhum arquivo correspondente encontrado para exportar." -ForegroundColor Red
    return
}

# Agrupa por plugin de primeiro nivel para exibicao amigavel
$rootPrefix = $RootPath.TrimEnd('\', '/') + '\'
$grouped = $foundFiles | Group-Object {
    $rel = $_.FullName.Substring($rootPrefix.Length)
    $firstFolder = $rel.Split([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)[0]
    $firstFolder
}

Write-Host "==> Arquivos identificados ($($foundFiles.Count) no total):" -ForegroundColor Green
foreach ($group in $grouped) {
    Write-Host ("    - {0,-25} : {1,3} arquivo(s)" -f $group.Name, $group.Count) -ForegroundColor White
}
Write-Host ""

# 3. Cria o arquivo ZIP
if (Test-Path $OutputFile) {
    Write-Host "==> Removendo arquivo ZIP anterior..." -ForegroundColor DarkGray
    Remove-Item -Path $OutputFile -Force
}

Write-Host "==> Compactando arquivos no ZIP..." -ForegroundColor Yellow

$zip = [System.IO.Compression.ZipFile]::Open($OutputFile, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $counter = 0
    foreach ($file in $foundFiles) {
        $counter++
        $relPath = $file.FullName.Substring($rootPrefix.Length).Replace('\', '/')
        
        if ($VerboseList) {
            Write-Host ("    [{0}/{1}] {2}" -f $counter, $foundFiles.Count, $relPath) -ForegroundColor DarkGray
        }

        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip,
            $file.FullName,
            $relPath,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally {
    $zip.Dispose()
}

$zipInfo = Get-Item $OutputFile
$sizeKB = [math]::Round($zipInfo.Length / 1KB, 2)

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Exportacao concluida com sucesso!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Arquivo gerado : $OutputFile" -ForegroundColor White
Write-Host "  Total arquivos : $($foundFiles.Count)" -ForegroundColor White
Write-Host "  Tamanho final  : $sizeKB KB ($($zipInfo.Length) bytes)" -ForegroundColor White
Write-Host ""
