#!/usr/bin/env python3
"""
Test script to verify the implementation works correctly.
This script tests the key backend endpoints that were created or modified.
"""

import requests
import json

# Configuration
BASE_URL = "http://localhost:8000"
USERNAME = "testuser"  # Replace with actual test username
PASSWORD = "testpass"  # Replace with actual test password

def get_auth_token():
    """Get authentication token for testing"""
    try:
        response = requests.post(f"{BASE_URL}/auth/api/login/", {
            "username": USERNAME,
            "password": PASSWORD
        })
        if response.status_code == 200:
            return response.json().get("token")
        else:
            print(f"Failed to get auth token: {response.status_code}")
            return None
    except Exception as e:
        print(f"Error getting auth token: {e}")
        return None

def test_endpoints():
    """Test the key endpoints"""
    token = get_auth_token()
    if not token:
        print("Cannot proceed without authentication token")
        return
    
    headers = {"Authorization": f"Token {token}"}
    
    print("Testing backend endpoints...")
    
    # Test 1: News feed API
    print("\n1. Testing news feed API...")
    try:
        response = requests.get(f"{BASE_URL}/main/api/articles/", headers=headers)
        print(f"News feed API: {response.status_code}")
        if response.status_code == 200:
            articles = response.json()
            print(f"Found {len(articles)} articles")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Error testing news feed: {e}")
    
    # Test 2: User list API
    print("\n2. Testing user list API...")
    try:
        response = requests.get(f"{BASE_URL}/profile/api/users/", headers=headers)
        print(f"User list API: {response.status_code}")
        if response.status_code == 200:
            users = response.json()
            print(f"Found {len(users)} users")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Error testing user list: {e}")
    
    # Test 3: User profile API
    print("\n3. Testing user profile API...")
    try:
        response = requests.get(f"{BASE_URL}/profile/api/profile/{USERNAME}/", headers=headers)
        print(f"User profile API: {response.status_code}")
        if response.status_code == 200:
            profile = response.json()
            print(f"Profile loaded for user: {profile.get('username')}")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Error testing user profile: {e}")
    
    # Test 4: Photo albums API
    print("\n4. Testing photo albums API...")
    try:
        response = requests.get(f"{BASE_URL}/photo/api/user/{USERNAME}/albums/", headers=headers)
        print(f"Photo albums API: {response.status_code}")
        if response.status_code == 200:
            albums = response.json()
            print(f"Found {len(albums)} albums")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Error testing photo albums: {e}")
    
    # Test 5: Chat room creation API
    print("\n5. Testing chat room creation API...")
    try:
        # This requires two users, so we'll test with the same user for now
        response = requests.get(f"{BASE_URL}/chat/api/get_private_room/{USERNAME}/{USERNAME}/", headers=headers)
        print(f"Chat room API: {response.status_code}")
        if response.status_code == 200:
            room_data = response.json()
            print(f"Room created/found: {room_data.get('room_name')}")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Error testing chat room: {e}")
    
    print("\nTesting completed!")

if __name__ == "__main__":
    print("Backend API Testing Script")
    print("=" * 40)
    test_endpoints()