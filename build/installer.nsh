!include nsDialogs.nsh
!include LogicLib.nsh
!include MUI2.nsh

!ifndef BUILD_UNINSTALLER

; Set the direct C-drive layout after electron-builder initializes install mode.
!macro customInit
  StrCpy $INSTDIR "C:\Rosemewbot"
!macroend

Var InstallLocationPage
Var DefaultInstallRadio
Var CustomInstallRadio
Var InstallLocationText
Var InstallLocationBrowse
Var RecommendedInstallDir

; Replace the generic directory page with two explicit choices.
!macro customPageAfterChangeDir
  Page custom InstallLocationPageCreate InstallLocationPageLeave
!macroend

Function InstallLocationPageCreate
  ; The install-mode initialization may assign a Program Files/AppData path.
  ; Reset both the recommended path and the editable custom path here, after it.
  StrCpy $RecommendedInstallDir "C:\Rosemewbot"
  StrCpy $INSTDIR $RecommendedInstallDir
  !insertmacro MUI_HEADER_TEXT "选择安装位置" "默认安装最省心，也可以把程序和机器人组件放到其他磁盘。"

  nsDialogs::Create 1018
  Pop $InstallLocationPage
  ${If} $InstallLocationPage == error
    Abort
  ${EndIf}

  ${NSD_CreateRadioButton} 0u 4u 100% 16u "默认安装（推荐）"
  Pop $DefaultInstallRadio
  ${NSD_Check} $DefaultInstallRadio

  ${NSD_CreateLabel} 18u 23u 92% 24u "直接安装到 C:\Rosemewbot，机器人数据保存在相邻的 Rosemewbot-data 目录。"
  Pop $0

  ${NSD_CreateRadioButton} 0u 57u 100% 16u "自定义位置"
  Pop $CustomInstallRadio

  ${NSD_CreateLabel} 18u 76u 92% 24u "选择 D 盘或其他父目录；程序、AstrBot、NapCat、独立 Python 与数据会放在其中。"
  Pop $0

  ${NSD_CreateText} 18u 108u 72% 13u "$RecommendedInstallDir"
  Pop $InstallLocationText

  ${NSD_CreateButton} 76% 107u 24% 15u "浏览…"
  Pop $InstallLocationBrowse

  ${NSD_OnClick} $DefaultInstallRadio InstallLocationModeChanged
  ${NSD_OnClick} $CustomInstallRadio InstallLocationModeChanged
  ${NSD_OnClick} $InstallLocationBrowse BrowseInstallLocation

  Call InstallLocationModeChanged
  nsDialogs::Show
FunctionEnd

Function InstallLocationModeChanged
  ${NSD_GetState} $DefaultInstallRadio $0
  ${If} $0 == ${BST_CHECKED}
    ${NSD_SetText} $InstallLocationText $RecommendedInstallDir
    EnableWindow $InstallLocationText 0
    EnableWindow $InstallLocationBrowse 0
  ${Else}
    EnableWindow $InstallLocationText 1
    EnableWindow $InstallLocationBrowse 1
  ${EndIf}
FunctionEnd

Function BrowseInstallLocation
  nsDialogs::SelectFolderDialog "选择程序和机器人数据的父目录" "$RecommendedInstallDir"
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $InstallLocationText "$0\${APP_FILENAME}"
  ${EndIf}
FunctionEnd

Function InstallLocationPageLeave
  ${NSD_GetText} $InstallLocationText $0
  ${If} $0 == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择安装位置。"
    Abort
  ${EndIf}
  StrCpy $INSTDIR $0
FunctionEnd

!endif
