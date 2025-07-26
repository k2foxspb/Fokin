// This is a simple test script to verify that the notification system is working correctly
// Run this script with Node.js to send a test notification to a device

const fetch = require('node-fetch');

// Replace these values with your actual values
const API_URL = 'https://fokin.fun/api/notifications/send-test/';
const USER_TOKEN = 'YOUR_USER_TOKEN'; // Replace with a valid user token
const DEVICE_TOKEN = 'YOUR_DEVICE_TOKEN'; // Replace with the Expo push token from the device

// Test notification types
const NOTIFICATION_TYPES = {
  GENERAL: 'general',
  MESSAGE: 'message_notification',
  SPECIFIC_CHAT: 'specific_chat'
};

async function sendTestNotification(type = NOTIFICATION_TYPES.MESSAGE) {
  try {
    console.log(`Sending ${type} test notification...`);
    
    let notificationData = {
      token: DEVICE_TOKEN,
      title: 'Test Notification',
      body: 'This is a test notification to verify that push notifications are working correctly.',
      data: {
        type: type,
        test: true
      }
    };
    
    // Add chat ID for specific chat notifications
    if (type === NOTIFICATION_TYPES.SPECIFIC_CHAT) {
      notificationData.title = 'New Message';
      notificationData.body = 'You have received a new message in a chat';
      notificationData.data.chatId = 1; // Replace with an actual chat ID
    } else if (type === NOTIFICATION_TYPES.MESSAGE) {
      notificationData.title = 'New Messages';
      notificationData.body = 'You have new unread messages';
    }
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${USER_TOKEN}`,
      },
      body: JSON.stringify(notificationData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to send notification: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('Notification sent successfully:', result);
  } catch (error) {
    console.error('Error sending test notification:', error);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const notificationType = args[0] || NOTIFICATION_TYPES.MESSAGE;

// Validate notification type
if (!Object.values(NOTIFICATION_TYPES).includes(notificationType)) {
  console.error(`Invalid notification type: ${notificationType}`);
  console.log(`Valid types are: ${Object.values(NOTIFICATION_TYPES).join(', ')}`);
  process.exit(1);
}

// Run the test
sendTestNotification(notificationType);

console.log('\nTo test notifications:');
console.log('1. Make sure the app is installed on your device');
console.log('2. Replace USER_TOKEN and DEVICE_TOKEN with actual values in this script');
console.log('3. Run this script with Node.js:');
console.log('   - For general notifications: node test-notifications.js general');
console.log('   - For message notifications: node test-notifications.js message_notification');
console.log('   - For specific chat notifications: node test-notifications.js specific_chat');
console.log('4. Check if the notification arrives on your device');
console.log('5. Try with the app in different states:');
console.log('   - Foreground: App is open and visible');
console.log('   - Background: App is open but not visible');
console.log('   - Killed: App is completely closed');
console.log('\nInstructions for getting the device token:');
console.log('1. Open the app on your device');
console.log('2. Look for the console log message "Push token: ExponentPushToken[...]"');
console.log('3. Copy the token and replace DEVICE_TOKEN in this script');