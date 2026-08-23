import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import org.kde.kirigami 2.20 as Kirigami
import org.kde.plasma.components 3.0 as PlasmaComponents3

Kirigami.FormLayout {
    id: configPage

    property alias cfg_shortcut: shortcutField.text
    property alias cfg_icon: iconField.text
    property alias cfg_enableKWallet: kwalletCheckBox.checked
    property alias cfg_enableAI: aiCheckBox.checked

    PlasmaComponents3.TextField {
        id: shortcutField
        Kirigami.FormData.label: "Global Activation Shortcut:"
        placeholderText: "Meta+Space"
    }

    PlasmaComponents3.TextField {
        id: iconField
        Kirigami.FormData.label: "System Tray Icon:"
        placeholderText: "utilities-terminal"
    }

    PlasmaComponents3.CheckBox {
        id: kwalletCheckBox
        Kirigami.FormData.label: "Security:"
        text: "Enable KDE Wallet (KWallet) key storage"
    }

    PlasmaComponents3.CheckBox {
        id: aiCheckBox
        Kirigami.FormData.label: "AI Assistant:"
        text: "Enable /ai natural language translation"
    }
}
