import { Text, View, StyleSheet, Button } from "react-native";
import { generateNonce, getPasskey } from "rn-multisig-wallet";

export default function App() {
  const onPress = async () => {
    const nonce = generateNonce();
    console.log(nonce);
    const passkey = await getPasskey({ nonce, rpId: "" });
    console.log(passkey);
  };
  return (
    <View style={styles.container}>
      <Button title="Generate Nonce" onPress={onPress} />
      <Text>App</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
