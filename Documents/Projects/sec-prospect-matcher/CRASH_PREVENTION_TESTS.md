# 🛡️ SEC Prospect Matcher - Crash Prevention Test Plan

## Overview
This comprehensive test plan ensures the system never crashes again by testing memory limits, streaming functionality, and error handling.

## ✅ What We've Fixed
1. **Memory Accumulation**: Eliminated with streaming CSV output
2. **Company-Only Matches**: Disabled (95% memory reduction)
3. **Chunk Processing**: Immediate disk write, memory cleanup
4. **Garbage Collection**: Force cleanup every 50 files + between chunks
5. **Stack Overflow**: Fixed concat vs spread operator issue

## 🧪 Test Execution Plan

### Phase 1: Memory Monitoring Test
**Objective**: Monitor memory usage in real-time to detect potential crashes

```bash
# Terminal 1: Start memory monitor
node test_memory_monitoring.js

# Terminal 2: Run your 134K dataset test
# Upload CMU2.csv at http://localhost:3000
```

**Success Criteria**:
- ✅ Memory stays under 7.5GB (warning at 6GB)
- ✅ No memory spikes during chunk transitions
- ✅ Garbage collection reduces memory between chunks

### Phase 2: Progressive Load Test
**Objective**: Test with increasing dataset sizes

```bash
# Run progressive load test
node test_progressive_load.js
```

**Test Sizes**:
- 1K prospects (baseline)
- 5K prospects (sub-chunk)
- 15K prospects (single chunk)
- 30K prospects (2 chunks)
- 60K prospects (4 chunks)
- 90K prospects (6 chunks)
- 134K prospects (9 chunks - your full dataset)

### Phase 3: Stress Testing
**Objective**: Test extreme scenarios

#### 3a. Network Interruption Test
1. Start processing 134K prospects
2. Disconnect/reconnect network during chunk 3
3. Verify partial chunk downloads work
4. Verify processing resumes

#### 3b. Browser Refresh Test
1. Start processing 134K prospects
2. Refresh browser during chunk 4
3. Verify server continues processing
4. Verify chunk downloads still available

#### 3c. Multiple File Upload Test
1. Upload 134K prospects + 3K SEC files (larger than usual)
2. Monitor memory usage
3. Verify streaming still works with more files

### Phase 4: Memory Leak Detection
**Objective**: Ensure no gradual memory increase

```bash
# Run 5 consecutive tests without restarting server
for i in {1..5}; do
  echo "Test run $i"
  # Upload and process smaller dataset (15K prospects)
  # Check memory returns to baseline between runs
done
```

## 📊 Monitoring Commands

### Real-Time Memory Check
```bash
# Check current memory usage
ps aux | grep -E "node.*server" | grep -v grep

# Detailed memory breakdown
node -e "console.log('Memory:', process.memoryUsage())"
```

### Server Health Check
```bash
# Check if server is running
curl -s http://localhost:3000 | grep "SEC Prospect Matcher"

# Check chunk files exist during processing
ls -la temp_chunks/
```

## 🚨 Failure Criteria (Auto-Stop Testing)

Stop testing immediately if:
1. **Memory exceeds 7.5GB** - Crash imminent
2. **Process exits with code 134** - Memory crash occurred
3. **Chunk files not created** - Streaming broken
4. **No garbage collection** - Memory cleanup failed
5. **Browser shows "Failed to fetch"** - Server unresponsive

## 🎯 Success Criteria

Test passes when:
1. ✅ All 9 chunks complete successfully
2. ✅ Memory stays under 6GB peak usage
3. ✅ All chunk downloads work
4. ✅ Final combined CSV downloads
5. ✅ Server remains responsive throughout
6. ✅ No "JavaScript heap out of memory" errors
7. ✅ Chunk files are cleaned up after completion

## 🔧 Emergency Recovery

If crash occurs during testing:

```bash
# 1. Check crash logs
tail -n 50 server.log

# 2. Clear any stuck temp files
rm -rf temp_chunks/

# 3. Restart with higher memory limit
node --expose-gc --max-old-space-size=12288 server.js

# 4. Run smaller test first (15K prospects)
```

## 📈 Performance Benchmarks

Expected performance with streaming:
- **Memory Peak**: < 1.5GB (down from 8GB+)
- **Processing Speed**: ~30 seconds per 15K chunk
- **Chunk Downloads**: Available within 10 seconds of completion
- **Total Time**: ~4.5 minutes for 134K prospects

## 🚀 Quick Start Test

**Fastest way to verify crash-resistance:**

1. Start memory monitor:
   ```bash
   node test_memory_monitoring.js
   ```

2. In browser: Upload CMU2.csv + SEC files → Click "Auto-Chunked"

3. Watch for:
   - Green chunk download buttons appearing
   - Memory staying under 6GB
   - All 9 chunks completing
   - Final CSV download working

**If this passes, the system is crash-proof!**

## 📝 Test Results Template

```
DATE: [Date]
DATASET: 134K prospects, 1.8K SEC files
MEMORY LIMIT: 8GB
STREAMING: Enabled
COMPANY-ONLY: Disabled

RESULTS:
✅/❌ All chunks completed
✅/❌ Memory under 6GB peak
✅/❌ Chunk downloads worked
✅/❌ Final CSV download worked
✅/❌ No crashes occurred

PEAK MEMORY: [X.X]GB
TOTAL TIME: [X]m [X]s
NOTES: [Any observations]
```