# STL2GLB Conversion Service

Servizio ad alte prestazioni per la conversione di file STL in formato GLB con storage MinIO, costruito con Node.js e un convertitore C++ ottimizzato.

## 🚀 Caratteristiche

- **📦 Storage MinIO**: Sistema di storage distribuito con deduplicazione
- **🔄 Cache Intelligente**: Deduplicazione basata su hash per evitare riconversioni
- **⚡ Convertitore Nativo**: Convertitore C++ ottimizzato per massime prestazioni
- **🎨 Personalizzazione Materiali**: Supporto per colori personalizzati, metallicità e rugosità
- **📊 Monitoraggio**: Health check e metriche complete
- **🔒 Produzione Ready**: Rate limiting, gestione errori, logging strutturato
- **🐳 Docker Ready**: Deployment containerizzato con Docker Compose
- **📈 Efficienza Risorse**: Limiti configurabili e pulizia automatica

## 🛠️ Avvio Rapido

### Utilizzando Docker Compose (Consigliato)

1. **Clonare e configurare**:

```bash
git clone <repository-url>
cd stl2glb-service
```

2. **Creare file di configurazione**:

```bash
# Creare il file .env con le configurazioni necessarie
cat > .env << EOF
# MinIO Configuration
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_USE_SSL=false
MINIO_BUCKET_STL=stl-files
MINIO_BUCKET_GLB=glb-files

# Service Configuration
NODE_ENV=production
PORT=9002
LOG_LEVEL=info
MAX_FILE_SIZE_MB=50
MAX_CONCURRENT_JOBS=10
TEMP_DIR=/tmp/stl2glb

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Security
CORS_ORIGIN=*
EOF
```

3. **Avviare i servizi**:

```bash
docker-compose up --build
```

4. **Verificare il deployment**:

```bash
curl http://localhost:9002/health
```

## 📡 API

### Conversione STL→GLB tramite Upload

**Endpoint**: `POST /api/convert/file`

Carica un file STL e lo converte in formato GLB.

**Parametri**:
- `stl` (richiesto): File STL (multipart/form-data)
- `color` (opzionale): Array RGB `[r, g, b]` (range 0-1)
- `metallic` (opzionale): Fattore metallico (0-1)
- `roughness` (opzionale): Fattore rugosità (0-1)  
- `generateNormals` (opzionale): Genera normali vertex (boolean)

**Esempio con curl**:

```bash
# Conversione base
curl -X POST http://localhost:9002/api/convert/file \
  -F "stl=@model.stl"

# Con materiale personalizzato
curl -X POST http://localhost:9002/api/convert/file \
  -F "stl=@model.stl" \
  -F "color=[1.0,0.0,0.0]" \
  -F "metallic=0.8" \
  -F "roughness=0.2" \
  -F "generateNormals=true"
```

### Conversione STL→GLB tramite Hash

**Endpoint**: `POST /api/convert/`

Converte un file STL già presente su MinIO utilizzando il suo hash.

**Body JSON**:
```json
{
  "stl_hash": "abc123...",
  "color": [1.0, 0.0, 0.0],
  "metallic": 0.8,
  "roughness": 0.2,
  "generateNormals": true
}
```

**Risposta**:
```json
{
  "glb_hash": "def456..."
}
```

### Download File Convertito

**Endpoint**: `GET /api/convert/download/:hash`

```bash
curl -O http://localhost:9002/api/convert/download/abc123...
```

### Health Check

**Endpoint**: `GET /health`

```bash
curl http://localhost:9002/health
```

**Health Check Dettagliato**: `GET /health/detailed`

**Metriche**: `GET /health/metrics` (formato Prometheus)

## ⚙️ Configurazione

### Variabili d'Ambiente

| Variabile | Descrizione | Default |
|-----------|-------------|---------|
| `NODE_ENV` | Ambiente (development/production) | `production` |
| `PORT` | Porta del servizio | `9002` |
| `LOG_LEVEL` | Livello di logging (error/warn/info/debug) | `info` |

#### Configurazione MinIO

| Variabile | Descrizione | Richiesta |
|-----------|-------------|-----------|
| `MINIO_ENDPOINT` | Endpoint server MinIO | ✅ |
| `MINIO_PORT` | Porta server MinIO | ✅ |
| `MINIO_ACCESS_KEY` | Chiave di accesso MinIO | ✅ |
| `MINIO_SECRET_KEY` | Chiave segreta MinIO | ✅ |
| `MINIO_USE_SSL` | Usa SSL per MinIO | `false` |
| `MINIO_BUCKET_STL` | Bucket per file STL | `stl-files` |
| `MINIO_BUCKET_GLB` | Bucket per file GLB | `glb-files` |

#### Limiti del Servizio  

| Variabile | Descrizione | Default |
|-----------|-------------|---------|
| `MAX_FILE_SIZE_MB` | Dimensione massima file in MB | `50` |
| `MAX_CONCURRENT_JOBS` | Conversioni simultanee massime | `10` |
| `TEMP_DIR` | Directory file temporanei | `/tmp/stl2glb` |

#### Rate Limiting

| Variabile | Descrizione | Default |
|-----------|-------------|---------|
| `RATE_LIMIT_WINDOW_MS` | Finestra rate limit (ms) | `900000` |
| `RATE_LIMIT_MAX_REQUESTS` | Richieste massime per finestra | `100` |

## 🏗️ Architettura

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Client    │ => │   Nginx     │ => │  STL2GLB    │
│             │    │ (Opzionale) │    │  Service    │
└─────────────┘    └─────────────┘    └─────────────┘
                                              │
                                              ▼
                   ┌─────────────┐    ┌─────────────┐
                   │   MinIO     │ <= │ C++ Native  │
                   │  Storage    │    │ Converter   │
                   └─────────────┘    └─────────────┘
```

### Componenti

1. **API Express.js**: API RESTful con validazione e gestione errori
2. **Convertitore C++**: Conversione STL→GLB ad alte prestazioni
3. **Storage MinIO**: Storage distribuito per file
4. **Nginx** (opzionale): Reverse proxy con rate limiting
5. **Docker**: Deployment containerizzato

### Flusso dei File

1. Il client carica il file STL tramite POST
2. Il servizio calcola l'hash del file per la deduplicazione
3. Se il GLB esiste in MinIO, restituisce il risultato cached
4. Altrimenti, salva l'STL in posizione temporanea
5. Esegue il convertitore C++ nativo con i parametri
6. Carica il GLB risultante su MinIO
7. Restituisce URL di download e metadati
8. Pulisce i file temporanei

## 📊 Performance

### Ottimizzazioni

- **C++ Nativo**: 10-50x più veloce di JavaScript/WASM
- **Efficienza Memoria**: Elaborazione streaming, footprint minimo
- **Cache Intelligente**: Deduplicazione basata su hash previene rielaborazioni
- **Elaborazione Concorrente**: Limiti di job configurabili
- **Limiti Risorse**: Vincoli di memoria e CPU

## 📈 Monitoraggio

### Endpoint Health

- `GET /health` - Stato base del servizio

### Logging

Logging JSON strutturato con Winston:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "Conversion completed",
  "filename": "model.stl",
  "duration": 1250,
  "outputSize": 1048576,
  "cached": false
}
```

## 🔧 Sviluppo

### Build Convertitore Nativo

```bash
# Build development
mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Debug ..
make -j$(nproc)

# Build release con ottimizzazioni
cmake -DCMAKE_BUILD_TYPE=Release ..
make -j$(nproc)
```

### Esecuzione Test

```bash
npm test
```

### Modalità Sviluppo

```bash
npm run dev
```

## 🚀 Deployment

### Deployment Produzione

```bash
docker-compose up --build -d
```

### Scaling

```bash
docker-compose up -d --scale stl2glb-service=3
```

### Health Check

Configurare monitoraggio con:

- Scraping metriche Prometheus
- Dashboard Grafana  
- Notifiche AlertManager

## 🔍 Risoluzione Problemi

### Problemi Comuni

**"Converter not found"**:
- Assicurarsi che il binario C++ sia compilato: `./stl2glb_native --version`
- Verificare permessi del file: `chmod +x stl2glb_native`

**"MinIO connection failed"**:
- Verificare che MinIO sia in esecuzione: `curl http://localhost:9000/minio/health/live`
- Controllare credenziali nel file `.env`
- Assicurarsi che i bucket esistano

**"Out of memory"**:
- Ridurre `MAX_CONCURRENT_JOBS`
- Aumentare limiti memoria container
- Controllare memory leak nei log

**"File too large"**:
- Aumentare `MAX_FILE_SIZE_MB`
- Regolare nginx `client_max_body_size`
- Verificare spazio disco disponibile

### Modalità Debug

```bash
LOG_LEVEL=debug NODE_ENV=development npm start
```

### Tuning Performance

```bash
# Controllare risorse sistema
docker stats

# Monitorare performance conversioni
curl http://localhost:9002/health/detailed

# Profilare convertitore nativo
valgrind --tool=callgrind ./stl2glb_native input.stl output.glb
```

## 📄 Licenza

Questo progetto è rilasciato sotto licenza MIT. Vedi il file LICENSE per i dettagli.

## 🤝 Contribuire

1. Fork del repository
2. Creare feature branch (`git checkout -b feature/amazing-feature`)
3. Commit delle modifiche (`git commit -m 'Add amazing feature'`)
4. Push del branch (`git push origin feature/amazing-feature`)
5. Aprire Pull Request

## 📞 Supporto

- 🐛 Issues: [GitHub Issues](https://github.com/your-org/stl2glb-service/issues)
- 📖 Documentazione: [Wiki](https://github.com/your-org/stl2glb-service/wiki)

---

**Nota**: Questo servizio è ottimizzato per ambienti di produzione e supporta carichi di lavoro ad alto volume con gestione efficiente delle risorse.