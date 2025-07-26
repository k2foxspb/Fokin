# Firebase Setup for EAS Builds

This document explains how to set up Firebase for EAS (Expo Application Services) builds, specifically how to handle the `google-services.json` file required for Android builds.

## Issue

When building the Android app using EAS, the build process requires a `google-services.json` file for Firebase integration. This file contains sensitive information and should not be committed to the repository.

## Solution

We've configured the EAS build process to use an environment variable to provide the `google-services.json` file during the build. This approach keeps sensitive information out of the repository while ensuring it's available during the build process.

## How to Set Up

### 1. Obtain the google-services.json file

If you haven't already, you need to create a Firebase project and download the `google-services.json` file:

1. Go to the [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select an existing one
3. Add an Android app to your Firebase project
   - Use the package name from app.json: `com.k2foxspb.fokinfun`
4. Download the `google-services.json` file

### 2. Encode the file as a base64 string

Since environment variables can't contain newlines or special characters, you need to encode the file as a base64 string:

**On Windows:**
```powershell
[Convert]::ToBase64String([System.IO.File]::ReadAllBytes("path\to\google-services.json"))
```

**On macOS/Linux:**
```bash
base64 -i path/to/google-services.json
```

### 3. Set up the EAS secret

Use the EAS CLI to set up a secret containing the base64-encoded content:

```bash
eas secret:create --name GOOGLE_SERVICES_JSON --value "your_base64_encoded_string"
```

### 4. For local development

For local development, you should place the `google-services.json` file in the root of the project. This file should not be committed to the repository (ensure it's in your `.gitignore`).

## How it Works

The `eas.json` file has been configured with:

1. An environment variable `GOOGLE_SERVICES_JSON` in each build profile
2. A prebuild hook that creates the `google-services.json` file from the environment variable

During the EAS build process:
1. The prebuild hook runs `echo $GOOGLE_SERVICES_JSON > google-services.json`
2. This creates the `google-services.json` file at the root of the project
3. The Expo build process then copies this file to the appropriate location in the Android app

## Troubleshooting

If you encounter build errors related to the `google-services.json` file:

1. Verify that you've set up the `GOOGLE_SERVICES_JSON` secret correctly
2. Check that the base64 encoding was done properly without line breaks
3. Ensure the package name in your Firebase project matches the one in app.json