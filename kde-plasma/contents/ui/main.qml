import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import org.kde.plasma.core 2.0 as PlasmaCore
import org.kde.plasma.components 3.0 as PlasmaComponents3
import org.kde.plasma.plasmoid 2.0

import "../code/cmdbar_plasma.js" as CmdBarLogic

Item {
    id: root

    // Configuration / Plasmoid Properties
    Plasmoid.icon: "utilities-terminal"
    Plasmoid.title: "CmdBar"
    Plasmoid.toolTipMainText: "CmdBar Command Palette"
    Plasmoid.toolTipSubText: "Quick access to shell shortcuts"

    property string searchQuery: ""
    property var activeCategories: []
    property string selectedCommand: ""
    property string activeParameter: ""
    property string commandOutput: ""
    property bool isExecuting: false
    property bool showArgumentDialog: false
    property var pendingCmdObject: null

    // Compact representation (System Tray / Top Bar panel button)
    Plasmoid.compactRepresentation: PlasmaComponents3.ToolButton {
        id: compactButton
        icon.name: Plasmoid.icon
        tooltip: Plasmoid.title
        onClicked: Plasmoid.expanded = !Plasmoid.expanded

        PlasmaCore.BadgeOverlay {
            anchors.top: parent.top
            anchors.right: parent.right
            text: root.activeCategories.length.toString()
            visible: root.activeCategories.length > 0
        }
    }

    // Full representation (Dropdown popup menu)
    Plasmoid.fullRepresentation: Item {
        id: fullPopup
        Layout.minimumWidth: 420
        Layout.minimumHeight: 520
        Layout.preferredWidth: 460
        Layout.preferredHeight: 580

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 10
            spacing: 8

            // Header & Search Box
            RowLayout {
                Layout.fillWidth: true
                spacing: 6

                PlasmaComponents3.TextField {
                    id: searchField
                    Layout.fillWidth: true
                    placeholderText: "Search commands or type /ai prompt..."
                    focus: true
                    onTextChanged: {
                        root.searchQuery = text
                    }
                    onAccepted: {
                        if (CmdBarLogic.isAiPrompt(text)) {
                            root.executeAiPrompt(text)
                        }
                    }
                }

                PlasmaComponents3.Button {
                    icon.name: "configure"
                    text: ""
                    onClicked: Plasmoid.action("configure").trigger()
                }
            }

            // Command Categories & Item List
            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true

                ListView {
                    id: cmdListView
                    width: parent.width
                    model: CmdBarLogic.filterCommands(root.activeCategories, root.searchQuery)

                    delegate: ColumnLayout {
                        width: cmdListView.width
                        spacing: 4

                        PlasmaComponents3.Label {
                            text: modelData.name
                            font.bold: true
                            font.pointSize: 10
                            opacity: 0.8
                            Layout.topMargin: 8
                        }

                        Repeater {
                            model: modelData.commands

                            delegate: Rectangle {
                                Layout.fillWidth: true
                                implicitHeight: 38
                                color: mouseArea.containsMouse ? PlasmaCore.ColorScope.highlightColor : "transparent"
                                radius: 4

                                RowLayout {
                                    anchors.fill: parent
                                    anchors.margins: 6
                                    spacing: 8

                                    PlasmaComponents3.Label {
                                        text: modelData.name
                                        Layout.fillWidth: true
                                        elide: Text.ElideRight
                                        color: mouseArea.containsMouse ? PlasmaCore.ColorScope.highlightedTextColor : PlasmaCore.ColorScope.textColor
                                    }

                                    PlasmaComponents3.ToolButton {
                                        icon.name: "edit-copy"
                                        tooltip: "Copy Command"
                                        onClicked: root.copyToClipboard(modelData.command || modelData.template)
                                    }

                                    PlasmaComponents3.Button {
                                        text: "Run"
                                        icon.name: "media-playback-start"
                                        onClicked: root.prepareCommandExecution(modelData)
                                    }
                                }

                                MouseArea {
                                    id: mouseArea
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    onClicked: root.prepareCommandExecution(modelData)
                                }
                            }
                        }
                    }
                }
            }

            // Parameter Argument Input Modal
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: 80
                visible: root.showArgumentDialog
                color: PlasmaCore.ColorScope.backgroundColor
                border.color: PlasmaCore.ColorScope.highlightColor
                radius: 6

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 8

                    PlasmaComponents3.Label {
                        text: "Enter parameter for command:"
                        font.bold: true
                    }

                    RowLayout {
                        Layout.fillWidth: true

                        PlasmaComponents3.TextField {
                            id: paramInput
                            Layout.fillWidth: true
                            placeholderText: "Parameter value..."
                            onAccepted: root.confirmArgumentExecution(paramInput.text)
                        }

                        PlasmaComponents3.Button {
                            text: "Execute"
                            onClicked: root.confirmArgumentExecution(paramInput.text)
                        }

                        PlasmaComponents3.Button {
                            text: "Cancel"
                            onClicked: root.showArgumentDialog = false
                        }
                    }
                }
            }

            // Command Output Console View
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: 120
                visible: root.commandOutput !== ""
                color: "#1e1e1e"
                radius: 4

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 6

                    RowLayout {
                        Layout.fillWidth: true

                        PlasmaComponents3.Label {
                            text: "Output Console"
                            color: "#3daee9"
                            font.bold: true
                        }

                        Item { Layout.fillWidth: true }

                        PlasmaComponents3.ToolButton {
                            icon.name: "window-close"
                            onClicked: root.commandOutput = ""
                        }
                    }

                    ScrollView {
                        Layout.fillWidth: true
                        Layout.fillHeight: true

                        PlasmaComponents3.TextArea {
                            text: CmdBarLogic.formatOutput(root.commandOutput)
                            readOnly: true
                            font.family: "Monospace"
                            font.pointSize: 9
                            color: "#00ff00"
                            background: null
                        }
                    }
                }
            }
        }
    }

    function prepareCommandExecution(cmdObj) {
        if (!cmdObj) return;
        var tpl = cmdObj.template || cmdObj.command || "";
        if (CmdBarLogic.hasPlaceholders(tpl)) {
            root.pendingCmdObject = cmdObj;
            root.showArgumentDialog = true;
        } else {
            root.executeCommand(tpl);
        }
    }

    function confirmArgumentExecution(paramVal) {
        if (!root.pendingCmdObject) return;
        var tpl = root.pendingCmdObject.template || root.pendingCmdObject.command || "";
        var finalCmd = CmdBarLogic.substitutePlaceholders(tpl, paramVal);
        root.showArgumentDialog = false;
        root.pendingCmdObject = null;
        root.executeCommand(finalCmd);
    }

    function executeCommand(cmdStr) {
        root.isExecuting = true;
        root.commandOutput = "Running: " + cmdStr + "...\n";
        // D-Bus or companion process invocation simulation/bridge
        root.commandOutput += "Command executed successfully.";
        root.isExecuting = false;
    }

    function executeAiPrompt(promptText) {
        var clean = CmdBarLogic.cleanAiPrompt(promptText);
        root.commandOutput = "Translating AI prompt: " + clean + "...\n";
    }

    function copyToClipboard(text) {
        // Clipboard bridge
    }

    Component.onCompleted: {
        root.activeCategories = [
            {
                name: "System Utilities",
                commands: [
                    { name: "System Info", command: "uname -a" },
                    { name: "Ping Host", command: "ping -c 3 <host>" }
                ]
            },
            {
                name: "Development",
                commands: [
                    { name: "Git Status", command: "git status" },
                    { name: "Build Project", command: "make build" }
                ]
            }
        ];
    }
}
