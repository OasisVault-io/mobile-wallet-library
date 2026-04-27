import { Text, View, StyleSheet } from "react-native";
import { generateMnemonic } from "rn-multisig-wallet";

const mnemonic = generateMnemonic();

export default function App() {
  return (
    <View style={styles.container}>
      <Text>{mnemonic}</Text>
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
