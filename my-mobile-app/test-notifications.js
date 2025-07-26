// This is a simple test script to verify that the notification system is working correctly
// Run this script with Node.js to send a test notification to a device

const fetch = require('node-fetch');

// Replace these values with your actual values
const API_URL = 'https://fokin.fun/api/notifications/send-test/';
const USER_TOKEN = 'YOUR_USER_TOKEN'; // Replace with a valid user token
const DEVICE_TOKEN = 'YOUR_DEVICE_TOKEN'; // Replace with the Expo push token from the device

async function sendTestNotification() {
  try {
    console.log('Sending test notification...');
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${USER_TOKEN}`,
      },
      body: JSON.stringify({
        token: DEVICE_TOKEN,
        title: 'Test Notification',
        body: 'This is a test notification to verify that push notifications are working correctly.',
        data: {
          type: 'message_notification',
          test: true
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to send notification: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('Notification sent successfully:', result);
    console.log('\nTo test notifications:');
    console.log('1. Make sure the app is installed on your device');
    console.log('2. Replace USER_TOKEN and DEVICE_TOKEN with actual values');
    console.log('3. Run this script with Node.js');
    console.log('4. Check if the notification arrives on your device');
    console.log('5. Try with the app in different states: foreground, background, and closed');
  } catch (error) {
    console.error('Error sending test notification:', error);
  }
}

// Run the test
sendTestNotification();

// Instructions for getting the device token:
// 1. Open the app on your device
// 2. Look for the console log message "Push token: ExponentPushToken[...]"
// 3. Copy the token and replace DEVICE_TOKEN above