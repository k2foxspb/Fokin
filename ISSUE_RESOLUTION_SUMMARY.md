# Issue Resolution Summary

## Issue Description
When building the mobile application (my-mobile-app) and downloading it to a phone, the app doesn't open, although the build process completes successfully and everything works during development.

## Root Cause
The issue was caused by the use of a web-specific API (`window.location.protocol`) in the NotificationContext.tsx file. This API is not available in a native mobile environment, causing the app to crash on startup when installed on a device.

Specifically, the code was trying to determine the WebSocket protocol (ws/wss) using `window.location.protocol`, which is only available in web browsers:

```typescript
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const { connect, disconnect } = useWebSocket(`/${wsProtocol}/notification/`, {
```

## Solution
The solution was to remove the web-specific code and rely on the properly configured API_CONFIG, which already handles the correct WebSocket URL based on the environment:

1. Added the import for API_CONFIG in NotificationContext.tsx:
   ```typescript
   import { API_CONFIG } from '../app/config';
   ```

2. Removed the web-specific code that was determining the WebSocket protocol:
   ```typescript
   // Removed: const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
   const { connect, disconnect } = useWebSocket(`/notification/`, {
   ```

The useWebSocket hook already uses API_CONFIG.WS_URL to construct the full WebSocket URL, so this change ensures that the correct protocol is used based on the environment without relying on web-specific APIs.

## Testing the Solution
To verify that the issue is resolved:

1. Build the app for production:
   ```
   npx eas build --platform android --profile production
   ```

2. Install the built app on a physical device.

3. Verify that the app opens successfully and functions as expected.

4. Test the notification functionality to ensure that WebSocket connections are working properly.

## Prevention
To prevent similar issues in the future:

1. Avoid using web-specific APIs (like `window`, `document`, etc.) in React Native applications.

2. Use environment-specific configuration (like API_CONFIG) for handling different environments.

3. Test production builds on physical devices regularly during development to catch similar issues early.