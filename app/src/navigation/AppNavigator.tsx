import Ionicons from "@expo/vector-icons/Ionicons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";

import CaptureScreen from "@/screens/CaptureScreen";
import DashboardScreen from "@/screens/DashboardScreen";
import DocumentsScreen from "@/screens/DocumentsScreen";
import SettingsScreen from "@/screens/SettingsScreen";
import WorkspaceScreen from "@/screens/WorkspaceScreen";

export type RootTabParamList = {
  Dashboard: undefined;
  Capture: undefined;
  Workspace: undefined;
  Documents: undefined;
  Settings: undefined;
};

type IoniconName = keyof typeof Ionicons.glyphMap;

/**
 * Maps each tab route to its focused/unfocused Ionicons glyph. react-navigation
 * renders a "MissingIcon" placeholder box whenever a screen doesn't set
 * tabBarIcon, which is what was showing up as the corrupted/"tofu" icons.
 */
const TAB_ICONS: Record<keyof RootTabParamList, { focused: IoniconName; unfocused: IoniconName }> = {
  Dashboard: { focused: "grid", unfocused: "grid-outline" },
  Capture: { focused: "camera", unfocused: "camera-outline" },
  Workspace: { focused: "sparkles", unfocused: "sparkles-outline" },
  Documents: { focused: "document-text", unfocused: "document-text-outline" },
  Settings: { focused: "settings", unfocused: "settings-outline" },
};

const Tab = createBottomTabNavigator<RootTabParamList>();

/**
 * Bottom-tab shell matching Vol 7_0 Section 3's navigation model.
 * Dashboard is the landing tab (owner opens the app to see business state,
 * not to a blank capture form) with Capture always one tap away, per
 * Vol 7_1 Section 4's "always-available entry point" requirement.
 */
export default function AppNavigator() {
  return (
    <Tab.Navigator
      initialRouteName="Dashboard"
      screenOptions={({ route }) => ({
        headerShown: true,
        tabBarIcon: ({ focused, color, size }) => {
          const icons = TAB_ICONS[route.name as keyof RootTabParamList];
          return (
            <Ionicons
              name={focused ? icons.focused : icons.unfocused}
              color={color}
              size={size}
            />
          );
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Capture" component={CaptureScreen} />
      <Tab.Screen
        name="Workspace"
        component={WorkspaceScreen}
        options={{ title: "AI Workspace" }}
      />
      <Tab.Screen name="Documents" component={DocumentsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
