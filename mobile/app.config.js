// CrewStaff mobile app config (Expo SDK 58).
// Push notifications need ./google-services.json from your Firebase project (see README).
// The build still works without it; the app then checks for new offers while it's open.
const fs = require("fs");
const path = require("path");

const hasFirebase = fs.existsSync(path.join(__dirname, "google-services.json"));

module.exports = {
  expo: {
    name: "CrewStaff",
    slug: "crewstaff",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "crewstaff",
    userInterfaceStyle: "light",
    android: {
      package: "com.crewstaff.app",
      versionCode: 1,
      adaptiveIcon: {
        backgroundColor: "#16181D",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
      ...(hasFirebase ? { googleServicesFile: "./google-services.json" } : {}),
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        { backgroundColor: "#16181D", image: "./assets/images/splash-icon.png", imageWidth: 120 },
      ],
      "expo-secure-store",
      // The server runs on a Mac on the local network over plain http.
      ["expo-build-properties", { android: { usesCleartextTraffic: true } }],
      ["expo-notifications", { color: "#D9480F", defaultChannel: "default" }],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};
