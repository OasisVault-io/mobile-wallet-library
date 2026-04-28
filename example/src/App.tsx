import { Text, View, StyleSheet, Button } from "react-native";
import { createWallet } from "rn-multisig-wallet";

// const mnemonic = generateMnemonic();

export default function App() {
  const onPress = async () => {
    const wallet = await createWallet({
      type: "ethereum",
    });
    console.log(await wallet.wallet.signMessage("test"));
  };
  return (
    <View style={styles.container}>
      <Button title="Create Wallet" onPress={onPress} />
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
