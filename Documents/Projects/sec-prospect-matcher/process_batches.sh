#!/bin/bash

# Batch Processing Script for SEC Prospect Matcher
# Usage: ./process_batches.sh

set -e  # Exit on any error

echo "🚀 SEC Prospect Matcher - Batch Processing"
echo "=========================================="

# Check if prospect_batches directory exists
if [ ! -d "prospect_batches" ]; then
    echo "❌ Error: prospect_batches directory not found"
    echo "💡 Run 'node split_prospects.js your_file.csv' first to create batches"
    exit 1
fi

# Count batch files
BATCH_COUNT=$(ls prospect_batches/prospects_batch_*.csv 2>/dev/null | wc -l)

if [ $BATCH_COUNT -eq 0 ]; then
    echo "❌ Error: No batch files found in prospect_batches/"
    exit 1
fi

echo "📊 Found $BATCH_COUNT prospect batches to process"
echo ""

# Create results directory
mkdir -p batch_results

# Process each batch
for batch_file in prospect_batches/prospects_batch_*.csv; do
    if [ -f "$batch_file" ]; then
        batch_name=$(basename "$batch_file" .csv)
        echo "📄 Processing $batch_name..."

        # Count prospects in this batch
        prospect_count=$(($(wc -l < "$batch_file") - 1))  # Subtract header
        echo "   📋 Prospects in batch: $prospect_count"

        echo "   ⏳ Upload this batch to http://localhost:3000 and run Linear Matching"
        echo "   💾 Save the result CSV to batch_results/${batch_name}_results.csv"
        echo ""

        read -p "   ✅ Press Enter when this batch is complete..."
        echo ""
    fi
done

echo "🎉 All batches processed!"
echo "📁 Check batch_results/ directory for all CSV files"
echo ""
echo "💡 Optional: Combine all results into one master CSV:"
echo "   head -1 batch_results/prospects_batch_001_results.csv > combined_results.csv"
echo "   tail -n +2 batch_results/prospects_batch_*_results.csv >> combined_results.csv"