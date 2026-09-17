# Project Startup Procedure

When starting up the project, follow these steps:

1. **Stop Any Web Server on Port 8000**:
   Close any existing local web server running on port 8000 (e.g., from `ingest`, `Verite`, or previous sessions).

   **PowerShell**:
   ```powershell
   Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
   ```

   **Command Prompt / Windows**:
   ```cmd
   for /f "tokens=5" %a in ('netstat -aon ^| findstr :8000') do taskkill /f /pid %a
   ```

2. **Start Local Web Server on Port 8000**:
   Start a local Python web server from this workspace directory (`c:\Bill\CC\js\AI\DataWrangling`):
   ```bash
   python -m http.server 8000
   ```
   Or in PowerShell:
   ```powershell
   Start-Process python -ArgumentList "-m http.server 8000"
   ```

3. **Verify Data Dependencies**:
   Ensure `COMMON/mentions.csv` exists. If missing:
   ```bash
   curl -o COMMON/mentions.csv https://stagetools.com/verite/COMMON/mentions.csv
   ```

4. **Access the Application**:
   Open in your browser:
   - Enslaver Review: [http://localhost:8000/ENSLAVER/](http://localhost:8000/ENSLAVER/)
   - Schedule to Census: [http://localhost:8000/schedule2census.htm](http://localhost:8000/schedule2census.htm)
   - Census to Census: [http://localhost:8000/census2census.htm](http://localhost:8000/census2census.htm)
