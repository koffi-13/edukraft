#!/bin/bash
# Run the e2e test suite
set -e
rm -rf /home/z/my-project/edukraft/server/data/*
mkdir -p /home/z/my-project/edukraft/server/data
cd /home/z/my-project/edukraft/server
POLYGON_MOCK_MODE=true PAYMENT_MOCK=true API_KEY=dev-key PORT=3099 node index.js > /tmp/edukraft-server.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"
sleep 3
# Verify server is listening
if ! curl -s http://localhost:3099/api/health > /dev/null 2>&1; then
  echo "ERROR: Server not responding"
  cat /tmp/edukraft-server.log
  kill $SERVER_PID 2>/dev/null
  exit 1
fi
echo "Server is up, running tests..."
node /home/z/my-project/edukraft/server/test-e2e.js
RESULT=$?
kill $SERVER_PID 2>/dev/null
rm -rf /home/z/my-project/edukraft/server/data/*
exit $RESULT