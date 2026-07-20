import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { AuthProvider, useAuth } from "../hooks/useAuth";

function RootNavigation() {
  const { user, role, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    const onTenantNotice = segments[0] === "tenant-notice";

    if (!user && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
    } else if (user && role === "tenant" && !onTenantNotice) {
      router.replace("/tenant-notice");
    } else if (user && role !== "tenant" && (inAuthGroup || onTenantNotice)) {
      router.replace("/(tabs)");
    }
  }, [user, role, isLoading, segments, router]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigation />
      <StatusBar style="auto" />
    </AuthProvider>
  );
}
