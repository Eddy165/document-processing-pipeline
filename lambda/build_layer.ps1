$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path .\layer\python | Out-Null
python -m pip install -r .\backend\requirements.txt -t .\layer\python
Write-Host 'Dependencies packaged under layer/python.'
