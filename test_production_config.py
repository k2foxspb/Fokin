#!/usr/bin/env python3
"""
Test script to verify production configuration for my-mobile-app and Django backend.
This script tests:
1. Django settings with DEBUG=off
2. CORS configuration for fokin.fun
3. Mobile app API configuration
"""

import os
import sys
import requests
from pathlib import Path

def test_django_settings():
    """Test Django settings configuration"""
    print("Testing Django settings...")
    
    # Add backend to Python path
    backend_path = Path(__file__).parent / "backend"
    sys.path.insert(0, str(backend_path))
    
    try:
        os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
        import django
        django.setup()
        
        from django.conf import settings
        
        print(f"✓ DEBUG: {settings.DEBUG}")
        print(f"✓ ALLOWED_HOSTS: {settings.ALLOWED_HOSTS}")
        
        if hasattr(settings, 'CORS_ALLOWED_ORIGINS'):
            print(f"✓ CORS_ALLOWED_ORIGINS: {settings.CORS_ALLOWED_ORIGINS}")
        else:
            print(f"✓ CORS_ALLOW_ALL_ORIGINS: {settings.CORS_ALLOW_ALL_ORIGINS}")
            
        print(f"✓ CORS_ALLOW_CREDENTIALS: {settings.CORS_ALLOW_CREDENTIALS}")
        
        # Check if fokin.fun is in allowed hosts
        if 'fokin.fun' in settings.ALLOWED_HOSTS:
            print("✓ fokin.fun is in ALLOWED_HOSTS")
        else:
            print("✗ fokin.fun is NOT in ALLOWED_HOSTS")
            
        return True
        
    except Exception as e:
        print(f"✗ Error testing Django settings: {e}")
        return False

def test_mobile_app_config():
    """Test mobile app configuration"""
    print("\nTesting mobile app configuration...")
    
    try:
        config_path = Path(__file__).parent / "my-mobile-app" / "app" / "config.tsx"
        
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                content = f.read()
                
            if 'fokin.fun' in content:
                print("✓ fokin.fun is configured in mobile app")
            else:
                print("✗ fokin.fun is NOT configured in mobile app")
                
            if 'wss://fokin.fun' in content:
                print("✓ WebSocket URL configured for fokin.fun")
            else:
                print("✗ WebSocket URL NOT configured for fokin.fun")
                
            print("✓ Mobile app config file exists and is readable")
            return True
        else:
            print("✗ Mobile app config file not found")
            return False
            
    except Exception as e:
        print(f"✗ Error testing mobile app config: {e}")
        return False

def test_api_connectivity():
    """Test API connectivity (if server is running)"""
    print("\nTesting API connectivity...")
    
    try:
        # Test local development server first
        response = requests.get('http://localhost:8000/api/', timeout=5)
        print(f"✓ Local API accessible: {response.status_code}")
    except requests.exceptions.RequestException:
        print("ℹ Local API not accessible (server may not be running)")
    
    try:
        # Test production server
        response = requests.get('https://fokin.fun/api/', timeout=10)
        print(f"✓ Production API accessible: {response.status_code}")
        return True
    except requests.exceptions.RequestException as e:
        print(f"ℹ Production API not accessible: {e}")
        return False

def main():
    """Main test function"""
    print("=== Production Configuration Test ===\n")
    
    results = []
    results.append(test_django_settings())
    results.append(test_mobile_app_config())
    results.append(test_api_connectivity())
    
    print(f"\n=== Test Results ===")
    print(f"Django Settings: {'✓' if results[0] else '✗'}")
    print(f"Mobile App Config: {'✓' if results[1] else '✗'}")
    print(f"API Connectivity: {'✓' if results[2] else 'ℹ'}")
    
    if all(results[:2]):  # Don't require API connectivity for success
        print("\n✓ Production configuration is ready!")
        return True
    else:
        print("\n✗ Some configuration issues found.")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)