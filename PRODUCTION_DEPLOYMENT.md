# Production Deployment Guide

## Overview
This document outlines the production configuration for the my-mobile-app Expo application and Django backend, configured to work with the fokin.fun domain.

## ✅ Completed Configurations

### 1. Mobile App (my-mobile-app)
- **API Configuration**: Configured to use `https://fokin.fun` for production
- **WebSocket Configuration**: Configured to use `wss://fokin.fun` for production
- **EAS Build**: Ready for production builds with auto-increment versioning
- **Environment Detection**: Automatically switches between development and production URLs

**Key Files:**
- `app/config.tsx`: API endpoint configuration
- `app.json`: Expo app configuration
- `eas.json`: EAS build configuration

### 2. Django Backend
- **CORS Configuration**: Restricted to allow only fokin.fun domain in production
- **DEBUG Setting**: Set to `False` for production
- **ALLOWED_HOSTS**: Includes fokin.fun domain
- **Static Files**: Configured for Yandex Cloud S3 storage in production

**Key Files:**
- `backend/settings.py`: Django settings with environment-based CORS
- `.env`: Environment variables with DEBUG=off

## 🚀 Deployment Instructions

### Mobile App Deployment

1. **Install EAS CLI** (if not already installed):
   ```bash
   npm install -g @expo/eas-cli
   ```

2. **Login to EAS**:
   ```bash
   eas login
   ```

3. **Build for Production**:
   ```bash
   cd my-mobile-app
   eas build --platform all --profile production
   ```

4. **Submit to App Stores** (optional):
   ```bash
   eas submit --platform all --profile production
   ```

### Django Backend Deployment

1. **Environment Variables**: Ensure production server has:
   - `DEBUG=off`
   - `ALLOWED_HOSTS=fokin.fun,79.174.95.254`
   - Database configuration
   - AWS credentials for Yandex Cloud

2. **Static Files**: Run collectstatic for production:
   ```bash
   python manage.py collectstatic --noinput
   ```

3. **Database Migration**:
   ```bash
   python manage.py migrate
   ```

## 🔧 Configuration Details

### CORS Settings
The Django backend is configured with environment-based CORS:
- **Development**: Allows all origins (`CORS_ALLOW_ALL_ORIGINS = True`)
- **Production**: Only allows fokin.fun domain (`CORS_ALLOWED_ORIGINS = ['https://fokin.fun', 'http://fokin.fun']`)

### API Endpoints
The mobile app automatically detects the environment:
- **Development**: `http://localhost:8000` and `ws://127.0.0.1:8000`
- **Production**: `https://fokin.fun` and `wss://fokin.fun`

### Security Features
- CORS credentials enabled for authentication
- Proper CORS headers configured for mobile app requests
- DEBUG disabled in production
- Static files served from Yandex Cloud S3

## ✅ Verification

Run the test script to verify configuration:
```bash
python test_production_config.py
```

Expected output:
- ✓ Django Settings: DEBUG=False, CORS configured
- ✓ Mobile App Config: fokin.fun endpoints configured
- ✓ API Connectivity: Production API accessible

## 📱 Mobile App Features
- Automatic environment detection
- Secure HTTPS/WSS connections in production
- Token-based authentication
- WebSocket support for real-time features
- Optimized for both iOS and Android

## 🔒 Security Considerations
- CORS restricted to fokin.fun domain only
- DEBUG disabled in production
- Secure WebSocket connections (WSS)
- Token-based API authentication
- Static files served from CDN (Yandex Cloud)

## 📋 Checklist for Production Deployment

### Before Deployment:
- [ ] Verify all environment variables are set correctly
- [ ] Test API connectivity to fokin.fun
- [ ] Ensure database is properly configured
- [ ] Check static files configuration
- [ ] Verify SSL certificates for fokin.fun

### Mobile App:
- [ ] Build production version with EAS
- [ ] Test on physical devices
- [ ] Verify API calls work with production backend
- [ ] Check WebSocket connections
- [ ] Submit to app stores (if required)

### Backend:
- [ ] Deploy Django application to production server
- [ ] Configure web server (nginx/apache) for fokin.fun
- [ ] Set up SSL certificates
- [ ] Configure database for production
- [ ] Set up static file serving
- [ ] Configure WebSocket support (if using channels)

## 🆘 Troubleshooting

### Common Issues:
1. **CORS Errors**: Ensure fokin.fun is in CORS_ALLOWED_ORIGINS
2. **API Connection Failed**: Check if fokin.fun is accessible and SSL is configured
3. **WebSocket Issues**: Verify WSS support on the server
4. **Build Failures**: Check EAS build logs for specific errors

### Debug Commands:
```bash
# Test Django settings
python manage.py shell -c "from django.conf import settings; print(f'DEBUG: {settings.DEBUG}'); print(f'ALLOWED_HOSTS: {settings.ALLOWED_HOSTS}')"

# Test mobile app build
cd my-mobile-app && eas build --platform android --profile production --local

# Test API connectivity
curl -I https://fokin.fun/api/
```

## 📞 Support
For issues with this deployment, check:
1. Django logs for backend issues
2. EAS build logs for mobile app issues
3. Browser developer tools for CORS issues
4. Server logs for connectivity issues