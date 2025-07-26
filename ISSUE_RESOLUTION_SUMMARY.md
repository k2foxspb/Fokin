# Issue Resolution: Expo Production Build Fix

## Issue Description
The Expo production build for the my-mobile-app application was failing. The app was not properly using production URLs when built for production.

## Root Cause
The issue was that the NODE_ENV environment variable was not being explicitly set to 'production' during the EAS build process. 

In the app/config.tsx file, the app determines whether to use development or production URLs based on the NODE_ENV environment variable:

```typescript
const DEV = process.env.NODE_ENV === 'development';

export const API_CONFIG = {
  // Базовый URL для HTTP запросов
  BASE_URL: DEV ? 'http://localhost:8000' : 'https://fokin.fun',

  // Базовый URL для WebSocket соединений
  WS_URL: DEV ? 'ws://127.0.0.1:8000' : 'wss://fokin.fun',
};
```

Without explicitly setting NODE_ENV to 'production' during the build process, the app was likely defaulting to using the development URLs (localhost), which would cause the app to fail in production.

## Solution
The solution was to modify the eas.json file to explicitly set NODE_ENV to 'production' for the production build profile. This ensures that when the app is built for production using EAS Build, it uses the production URLs.

### Changes Made
Added an "env" section to the production build profile in eas.json:

```json
"production": {
  "autoIncrement": true,
  "env": {
    "NODE_ENV": "production"
  },
  "android": {
    "buildType": "apk"
  }
}
```

## Verification
The test_production_config.py script was run to verify that the mobile app configuration is correctly set up with fokin.fun and wss://fokin.fun URLs.

## Additional Notes
- The app uses a centralized configuration file (app/config.tsx) to manage environment-specific URLs
- The app automatically switches between development and production URLs based on the NODE_ENV environment variable
- For local development, NODE_ENV should be 'development'
- For production builds, NODE_ENV should be 'production'

## Build Instructions
To build the app for production, use the following command:
```bash
cd my-mobile-app
eas build --platform all --profile production
```

This will use the production build profile from eas.json, which now includes the NODE_ENV=production environment variable.