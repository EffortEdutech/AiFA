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
      screenOptions={{ headerShown: true }}
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
