# Mobile App Production Configuration

## Overview
The mobile app has been successfully configured for production deployment with centralized configuration management. All hardcoded localhost references have been replaced with environment-aware configuration.

## Configuration Structure

### Main Configuration File
**Location**: `my-mobile-app/app/config.tsx`

```typescript
const DEV = process.env.NODE_ENV === 'development';

export const API_CONFIG = {
  // Базовый URL для HTTP запросов
  BASE_URL: DEV ? 'http://localhost:8000' : 'https://fokin.fun',

  // Базовый URL для WebSocket соединений
  WS_URL: DEV ? 'ws://127.0.0.1:8000' : 'wss://fokin.fun',
};
```

### Environment Detection
- **Development**: Uses localhost URLs (http://localhost:8000, ws://127.0.0.1:8000)
- **Production**: Uses production URLs (https://fokin.fun, wss://fokin.fun)
- Environment is determined by `process.env.NODE_ENV`

## Updated Files

The following files have been updated to use the centralized configuration:

### Authentication Files
- `app/(auth)/login.tsx` - Login functionality
- `app/(auth)/register.tsx` - User registration
- `app/(auth)/forgot-password.tsx` - Password recovery

### Chat and Messaging
- `app/chat/[id].tsx` - Individual chat screen
- `app/(tabs)/messages.tsx` - Messages list screen

### WebSocket Integration
- `hooks/useWebSocket.ts` - WebSocket connection management

## Configuration Usage

### Importing Configuration
```typescript
import { API_CONFIG } from '../config';
// or
import { API_CONFIG } from '@/app/config';
```

### HTTP Requests
```typescript
const response = await axios.get(`${API_CONFIG.BASE_URL}/api/endpoint/`);
```

### WebSocket Connections
```typescript
const wsUrl = `${API_CONFIG.WS_URL}/ws/endpoint/`;
```

### Image URLs
```typescript
// Example usage in React Native components
const imageUri = `${API_CONFIG.BASE_URL}${imagePath}`;
// Then use in Image component: source={{ uri: imageUri }}
```

## Environment Configuration

### .env.example File
A template environment file has been created at `my-mobile-app/.env.example` with the following options:

```env
# Environment mode (development/production)
NODE_ENV=development

# API Configuration
API_BASE_URL_DEV=http://localhost:8000
API_BASE_URL_PROD=https://fokin.fun

# WebSocket Configuration
WS_BASE_URL_DEV=ws://127.0.0.1:8000
WS_BASE_URL_PROD=wss://fokin.fun

# Additional Configuration Options
DEBUG_MODE=true
API_TIMEOUT=10000
WS_RECONNECT_INTERVAL=3000
WS_MAX_RECONNECT_ATTEMPTS=5
```

## Production Deployment Steps

### 1. Environment Setup
```bash
# Set production environment
export NODE_ENV=production

# Or create .env file
echo "NODE_ENV=production" > my-mobile-app/.env
```

### 2. Build Configuration
The app will automatically use production URLs when `NODE_ENV=production`

### 3. Verification
Run the test script to verify configuration:
```bash
node test_mobile_config.js
```

Expected output:
```
✅ Configuration is properly set up for production deployment!
✅ All files are clean - no hardcoded localhost references found!
```

## Testing

### Development Testing
- Set `NODE_ENV=development`
- App will use localhost URLs
- Suitable for local development and testing

### Production Testing
- Set `NODE_ENV=production`
- App will use production URLs (fokin.fun)
- Test before final deployment

## Security Considerations

1. **Environment Variables**: Sensitive configuration should be stored in environment variables
2. **HTTPS/WSS**: Production uses secure protocols (HTTPS/WSS)
3. **Token Management**: Authentication tokens are properly handled in all API calls

## Troubleshooting

### Common Issues
1. **Wrong Environment**: Verify `NODE_ENV` is set correctly
2. **Network Issues**: Check if production URLs are accessible
3. **CORS Issues**: Ensure backend allows requests from mobile app

### Debug Steps
1. Check console logs for connection attempts
2. Verify API_CONFIG values in runtime
3. Test individual endpoints manually

## Maintenance

### Adding New Endpoints
1. Import `API_CONFIG` in the new file
2. Use `${API_CONFIG.BASE_URL}` for HTTP requests
3. Use `${API_CONFIG.WS_URL}` for WebSocket connections
4. Never hardcode URLs

### Configuration Updates
1. Update `config.tsx` for new environments
2. Update `.env.example` with new variables
3. Test in both development and production modes

## Summary

✅ **Completed Tasks:**
- Replaced all hardcoded localhost references
- Implemented centralized configuration
- Updated authentication files
- Updated chat and messaging components
- Configured WebSocket connections
- Created environment configuration template
- Added comprehensive testing
- Created production deployment documentation

The mobile app is now ready for production deployment with proper environment-aware configuration management.