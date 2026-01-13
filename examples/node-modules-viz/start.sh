#!/bin/bash
cd "$(dirname "$0")"

# Kill any existing processes on our ports
pkill -f "node server.mjs" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true

echo "🚀 Starting node-modules-viz..."
echo ""

# Start backend
node server.mjs &
BACKEND_PID=$!

# Start frontend  
pnpm dev &
FRONTEND_PID=$!

echo ""
echo "✨ Both servers started!"
echo "   Backend:  ws://localhost:4242"
echo "   Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for Ctrl+C
trap "echo ''; echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM

# Wait for either to exit
wait
