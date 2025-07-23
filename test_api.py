import requests
import json

# Test configuration
BASE_URL = 'http://localhost:8000'
LOGIN_URL = f'{BASE_URL}/auth/api/login/'
USERS_LIST_URL = f'{BASE_URL}/profile/api/users/'
USER_PROFILE_URL = f'{BASE_URL}/profile/api/profile/'

def test_api_endpoints():
    print("Testing API endpoints...")
    
    # Test data - you'll need to replace with actual user credentials
    test_credentials = {
        'username': 'test@example.com',  # Replace with actual email
        'password': 'testpassword'       # Replace with actual password
    }
    
    try:
        # Test login endpoint
        print("\n1. Testing login endpoint...")
        login_response = requests.post(LOGIN_URL, data=test_credentials)
        
        if login_response.status_code == 200:
            login_data = login_response.json()
            token = login_data.get('token')
            print(f"✓ Login successful. Token: {token[:20]}...")
            
            headers = {'Authorization': f'Token {token}'}
            
            # Test users list endpoint
            print("\n2. Testing users list endpoint...")
            users_response = requests.get(USERS_LIST_URL, headers=headers)
            
            if users_response.status_code == 200:
                users_data = users_response.json()
                print(f"✓ Users list retrieved successfully. Found {len(users_data)} users.")
                
                if users_data:
                    print("Sample user data:")
                    sample_user = users_data[0]
                    print(json.dumps(sample_user, indent=2, ensure_ascii=False))
                    
                    # Test user profile endpoint
                    print(f"\n3. Testing user profile endpoint for user: {sample_user['username']}")
                    profile_url = f"{USER_PROFILE_URL}{sample_user['username']}/"
                    profile_response = requests.get(profile_url, headers=headers)
                    
                    if profile_response.status_code == 200:
                        profile_data = profile_response.json()
                        print("✓ User profile retrieved successfully.")
                        print("Profile data:")
                        print(json.dumps(profile_data, indent=2, ensure_ascii=False))
                    else:
                        print(f"✗ User profile request failed: {profile_response.status_code}")
                        print(profile_response.text)
                        
                else:
                    print("No users found in the database.")
                    
            else:
                print(f"✗ Users list request failed: {users_response.status_code}")
                print(users_response.text)
                
        else:
            print(f"✗ Login failed: {login_response.status_code}")
            print(login_response.text)
            print("Please check your credentials and make sure the Django server is running.")
            
    except requests.exceptions.ConnectionError:
        print("✗ Connection error. Make sure the Django server is running on localhost:8000")
    except Exception as e:
        print(f"✗ Error occurred: {str(e)}")

if __name__ == "__main__":
    print("API Endpoints Test Script")
    print("=" * 40)
    print("Make sure to:")
    print("1. Start the Django server: python manage.py runserver")
    print("2. Update test_credentials with valid user data")
    print("3. Run this script: python test_api.py")
    print("=" * 40)
    
    test_api_endpoints()